const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

// Initialize DynamoDB client
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-south-1",
});
const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Lambda handler - Redirect to original URL
 */
exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  try {
    // Extract slug from path parameter
    // Format: /abc123 or just abc123
    const slug = event.pathParameters?.slug || event.path?.replace("/", "");

    if (!slug) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing slug parameter" }),
      };
    }

    // Fetch URL from DynamoDB
    const params = {
      TableName: TABLE_NAME,
      Key: { slug },
    };

    const result = await dynamodb.send(new GetCommand(params));

    // Check if slug exists
    if (!result.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/html" },
        body: `
          <!DOCTYPE html>
          <html>
          <head>
            <title>404 - Short URL Not Found</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              h1 { color: #e74c3c; }
            </style>
          </head>
          <body>
            <h1>404 - Short URL Not Found</h1>
            <p>The short URL <strong>${slug}</strong> does not exist or has expired.</p>
          </body>
          </html>
        `,
      };
    }

    const { url } = result.Item;

    // Increment click counter (fire-and-forget - don't wait for response)
    // This runs async in background to not slow down redirect
    incrementClickCount(slug).catch((err) => {
      console.error("Error incrementing click count:", err);
      // Don't fail the redirect if analytics update fails
    });

    console.log(`Redirecting ${slug} -> ${url}`);

    // Return 301 permanent redirect
    return {
      statusCode: 301,
      headers: {
        Location: url,
        "Cache-Control": "public, max-age=300", // Cache for 5 minutes
      },
      body: "",
    };
  } catch (error) {
    console.error("Error in redirect handler:", error);

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

/**
 * Increment click count for analytics
 * Fire-and-forget async operation
 */
async function incrementClickCount(slug) {
  const params = {
    TableName: TABLE_NAME,
    Key: { slug },
    UpdateExpression: "ADD clicks :increment SET lastAccessedAt = :timestamp",
    ExpressionAttributeValues: {
      ":increment": 1,
      ":timestamp": new Date().toISOString(),
    },
  };

  try {
    await dynamodb.send(new UpdateCommand(params));
    console.log(`Click count incremented for ${slug}`);
  } catch (error) {
    console.error("Error in incrementClickCount:", error);
    throw error;
  }
}
