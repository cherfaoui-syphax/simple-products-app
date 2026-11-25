export const handler = async (event) => {
  // TODO implement


  console.log(JSON.stringify(event));

  console.log(`CI CD is working`);
  console.log(`Hello from Lambda!`);
  const response = {
    statusCode: 200,
    body: JSON.stringify('Hello from Lambda!'),
  };
  return response;
};
