export const handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  console.log('Received event:', JSON.stringify(event, null, 2));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log('Processing products...');
  lastModified = new Date().toISOString();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log('Products processed successfully.');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Products function' }),
  };
};
