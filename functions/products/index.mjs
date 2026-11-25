export const handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  console.log('Received event:', JSON.stringify(event, null, 2));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log('Processing products...');

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Products function' }),
  };
};
