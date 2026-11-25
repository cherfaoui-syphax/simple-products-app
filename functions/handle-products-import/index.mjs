export const handler = async (event) => {
  // TODO implement


  console.log(`Event: ${JSON.stringify(event)}`);
  console.log(`Method: ${event.httpMethod}`);

  console.log(`CI CD is working`);
  console.log(`Hello from Lambda!`);


  console.log(`Event body: ${JSON.stringify(event.body)}` , typeof event.body);

  
  const response = {
    statusCode: 200,
    body: JSON.stringify('Hello from Lambda!'),
  };
  return response;
};
