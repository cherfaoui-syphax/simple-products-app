import { createHash } from "node:crypto";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  S3Client,
  GetObjectCommand
} from "@aws-sdk/client-s3";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import {
  DynamoDBDocumentClient,
  BatchWriteCommand
} from "@aws-sdk/lib-dynamodb";

import { parse } from "csv-parse";

const s3 = new S3Client({});

const dynamodb = DynamoDBDocumentClient.from(
  new DynamoDBClient({})
);

const TABLE = process.env.PRODUCTS_TABLE ?? "products";
const BATCH_SIZE = 25;


// FILE FORMAT

const getFormat = (key) => {
  if (key.toLowerCase().endsWith(".csv")) return "csv";
  if (key.toLowerCase().endsWith(".jsonl")) return "jsonl";

  throw new Error(`Unsupported file format: ${key}`);
};


// JSONL PARSER

async function* parseJSONL(source) {
  let buffer = "";

  for await (const chunk of source) {
    buffer += chunk;

    let index;

    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();

      buffer = buffer.slice(index + 1);

      if (line) {
        yield JSON.parse(line);
      }
    }
  }

  if (buffer.trim()) {
    yield JSON.parse(buffer.trim());
  }
}


// PARSER FACTORY

const createParser = (format) => {
  if (format === "csv") {
    return parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    });
  }

  return parseJSONL;
};


// PRODUCT VALIDATION

const validateProduct = (product) => {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    throw new Error("Invalid product");
  }

  if (typeof product.name !== "string" || !product.name.trim()) {
    throw new Error("Invalid product name");
  }

  if (
    typeof product.price !== "number" ||
    !Number.isFinite(product.price) ||
    product.price < 0
  ) {
    throw new Error("Invalid product price");
  }
};


// PRODUCT TRANSFORM STREAM

const createProductTransform = (format, source) => {
  let rowNumber = 0;

  return new Transform({
    objectMode: true,

    transform(record, encoding, callback) {
      try {
        rowNumber++;

        if (format === "csv") {
          record.price = record.price?.trim()
            ? Number(record.price)
            : NaN;
        }

        validateProduct(record);

        const id = createHash("sha256")
          .update(JSON.stringify([
            source.bucket,
            source.key,
            source.version,
            rowNumber
          ]))
          .digest("hex");

        const product = {
          ...record,
          id,
          createdAt: source.eventTime
        };

        callback(null, product);

      } catch (error) {
        callback(error);
      }
    }
  });
};


// BATCH TRANSFORM STREAM

const createBatchTransform = (size = BATCH_SIZE) => {
  let batch = [];

  return new Transform({
    objectMode: true,

    transform(product, encoding, callback) {
      batch.push(product);

      if (batch.length >= size) {
        const result = batch;
        batch = [];

        return callback(null, result);
      }

      callback();
    },

    flush(callback) {
      if (batch.length > 0) {
        this.push(batch);
      }

      callback();
    }
  });
};


// DYNAMODB BATCH WRITE

const writeBatch = async (products) => {
  const result = await dynamodb.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE]: products.map(product => ({
          PutRequest: {
            Item: product
          }
        }))
      }
    })
  );

  const unprocessed = result.UnprocessedItems?.[TABLE] ?? [];

  if (unprocessed.length > 0) {
    throw new Error(
      `${unprocessed.length} products could not be written`
    );
  }

  console.log(`Written ${products.length} products`);
};


// DYNAMODB WRITABLE STREAM

const createDynamoDBWriter = () => {
  return new Writable({
    objectMode: true,
    highWaterMark: 1,

    write(batch, encoding, callback) {
      writeBatch(batch)
        .then(() => callback())
        .catch(callback);
    }
  });
};


// IMPORT FILE

const importFile = async (record) => {
  const bucket = record.s3.bucket.name;

  const key = decodeURIComponent(
    record.s3.object.key.replace(/\+/g, " ")
  );

  if (!key.startsWith("imports/")) {
    return;
  }

  const format = getFormat(key);

  const source = {
    bucket,
    key,
    version:
      record.s3.object.versionId ??
      record.s3.object.sequencer,
    eventTime: record.eventTime
  };

  const { Body } = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,

      ...(record.s3.object.versionId
        ? { VersionId: record.s3.object.versionId }
        : {}),

      ...(record.s3.object.eTag
        ? { IfMatch: `"${record.s3.object.eTag}"` }
        : {})
    })
  );

  if (!Body) {
    throw new Error("Missing S3 response body");
  }

  console.log(`Importing ${key}`);

  await pipeline(
    Body.setEncoding("utf8"),
    createParser(format),
    createProductTransform(format, source),
    createBatchTransform(25),
    createDynamoDBWriter()
  );

  console.log(`Successfully imported ${key}`);
};


// SQS MESSAGE PROCESSOR

const processMessage = async (message) => {
  const body = JSON.parse(message.body);

  if (body.Event === "s3:TestEvent") {
    return;
  }

  for (const record of body.Records) {
    if (record.eventName?.startsWith("ObjectCreated:")) {
      await importFile(record);
    }
  }
};


// LAMBDA HANDLER

export const handler = async (event) => {
  const batchItemFailures = [];

  for (const message of event.Records) {
    try {
      await processMessage(message);

    } catch (error) {
      console.error(error);

      batchItemFailures.push({
        itemIdentifier: message.messageId
      });
    }
  }

  return { batchItemFailures };
};