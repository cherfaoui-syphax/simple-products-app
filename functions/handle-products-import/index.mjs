export const handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  const { body } = event;
  const { products } = JSON.parse(body);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Handle products import function' }),
  };
};
