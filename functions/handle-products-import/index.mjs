export const handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  const { body } = event;
  
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Handle products import function' }),
  };
};
