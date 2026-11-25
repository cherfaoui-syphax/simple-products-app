import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";

const s3 = new S3Client({});

const BUCKET = process.env.PRODUCTS_BUCKET;


const dynamodb = DynamoDBDocumentClient.from(
  new DynamoDBClient({})
);

const TABLE = process.env.PRODUCTS_TABLE ?? "products";

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// GET ALL PRODUCTS

const getProducts = async () => {
  const products = [];
  let lastEvaluatedKey;

  do {
    const result = await dynamodb.send(
      new ScanCommand({
        TableName: TABLE,
        ExclusiveStartKey: lastEvaluatedKey
      })
    );

    products.push(...(result.Items ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey;

  } while (lastEvaluatedKey);

  return products;
};

// GET PRODUCT BY ID

const getProduct = async (id) => {
  const result = await dynamodb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { id }
    })
  );

  if (!result.Item) {
    throw new HttpError(404, "Product not found");
  }

  return result.Item;
};

// CREATE PRODUCT

const createProduct = async (data) => {
  validateProduct(data);

  const product = {
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };

  await dynamodb.send(
    new PutCommand({
      TableName: TABLE,
      Item: product,
      ConditionExpression: "attribute_not_exists(id)"
    })
  );

  return product;
};

// UPDATE PRODUCT

const updateProduct = async (id, data) => {
  validateProduct(data);

  const existingProduct = await getProduct(id);

  const product = {
    ...data,
    id,
    createdAt: existingProduct.createdAt,
    updatedAt: new Date().toISOString()
  };

  try {
    await dynamodb.send(
      new PutCommand({
        TableName: TABLE,
        Item: product,
        ConditionExpression: "attribute_exists(id)"
      })
    );
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      throw new HttpError(404, "Product not found");
    }

    throw error;
  }

  return product;
};

// DELETE PRODUCT

const deleteProduct = async (id) => {
  try {
    await dynamodb.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { id },
        ConditionExpression: "attribute_exists(id)"
      })
    );
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      throw new HttpError(404, "Product not found");
    }

    throw error;
  }

  return { message: "Product deleted", id };
};

// get upload url

const generateUploadUrl = async () => {
  const id = randomUUID();
  const key = `imports/${id}.csv`;
  const expiresIn = 300;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: "text/csv"
  });

  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn
  });

  return {
    id,
    key,
    uploadUrl,
    expiresIn
  };
};

// PRODUCT VALIDATION

const validateProduct = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "Invalid product");
  }

  if (typeof data.name !== "string" || !data.name.trim()) {
    throw new HttpError(400, "Product name is required");
  }

  if (
    typeof data.price !== "number" ||
    !Number.isFinite(data.price) ||
    data.price < 0
  ) {
    throw new HttpError(400, "Invalid product price");
  }
};

// PARSE REQUEST BODY

const parseBody = (event) => {
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;

    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
};

// CSV CONVERSION

const escapeCSV = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  let text = typeof value === "object"
    ? JSON.stringify(value)
    : String(value);

  // Protect against spreadsheet formula injection
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return `"${text.replace(/"/g, '""')}"`;
};

const convertToCSV = (products) => {
  const columns = [
    ...new Set([
      "id",
      "name",
      "price",
      ...products.flatMap(product => Object.keys(product))
    ])
  ];

  const header = columns.map(escapeCSV).join(",");

  const rows = products.map(product =>
    columns
      .map(column => escapeCSV(product[column]))
      .join(",")
  );

  return [header, ...rows].join("\r\n");
};

// RESPONSE HELPERS

const jsonResponse = (body, statusCode = 200) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(body)
});

const fileResponse = (body, filename, contentType) => ({
  statusCode: 200,
  headers: {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store"
  },
  body,
  isBase64Encoded: false
});

// EXPORT PRODUCTS

const exportProducts = (products, format) => {
  switch (format) {
    case "csv":
      return fileResponse(
        convertToCSV(products),
        "products.csv",
        "text/csv; charset=utf-8"
      );

    case "json":
      return fileResponse(
        JSON.stringify(products, null, 2),
        "products.json",
        "application/json"
      );

    default:
      throw new HttpError(400, "Unsupported file format");
  }
};

// LAMBDA HANDLER

export const handler = async (event, context) => {
  const method = event.httpMethod;
  const resource = event.resource;
  const id = event.pathParameters?.id;
  const format = event.queryStringParameters?.format;

  console.log(`${method} ${resource}`);

  try {
    switch (`${method} ${resource}`) {

      case "GET /products": {
        if (
          format !== undefined &&
          !["csv", "json"].includes(format)
        ) {
          throw new HttpError(400, "Unsupported file format");
        }

        const products = await getProducts();

        if (format) {
          return exportProducts(products, format);
        }

        return jsonResponse(products);
      }

      case "GET /products/{id}":
        return jsonResponse(
          await getProduct(id)
        );

      case "PATCH /products/{id}":
        return jsonResponse(
          await updateProduct(id, parseBody(event))
        );

      case "POST /products":
        return jsonResponse(
          await createProduct(parseBody(event)),
          201
        );

      case "PUT /products/{id}":
        return jsonResponse(
          await updateProduct(id, parseBody(event))
        );

      case "DELETE /products/{id}":
        return jsonResponse(
          await deleteProduct(id)
        );

      case "POST /products/imports":
        return jsonResponse(
          await generateUploadUrl()
        );

      default:
        return jsonResponse(
          { message: "Route not found" },
          404
        );
    }
  } catch (error) {
    console.error(error);

    return jsonResponse(
      {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      error instanceof HttpError
        ? error.statusCode
        : 500
    );
  }
};