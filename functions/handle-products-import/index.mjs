export const handler = async (event) => {
  // TODO implement


  console.log(JSON.stringify(event));

  console.log(`CI CD is working`);
  const response = {
    statusCode: 200,
    body: JSON.stringify('Hello from Lambda!'),
  };
  return response;
};
