const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

// Initialize DynamoDB client
const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-south-1",
});
const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Generate a random 6-character alphanumeric slug
 */
function generateSlug() {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let slug = "";
  for (let i = 0; i < 6; i++) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return slug;
}

/**
 * Check if a slug already exists in DynamoDB
 */
async function slugExists(slug) {
  const params = {
    TableName: TABLE_NAME,
    Key: { slug },
  };

  try {
    const result = await dynamodb.send(new GetCommand(params));
    return !!result.Item; // Returns true if item exists
  } catch (error) {
    console.error("Error checking slug existence:", error);
    throw error;
  }
}

/**
 * Lambda handler - Shorten a URL
 */
exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  try {
    // Parse request body
    const body = JSON.parse(event.body || "{}");
    const { url } = body;

    // Validation
    if (!url) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing required field: url" }),
      };
    }

    // Basic URL validation
    try {
      new URL(url); // Throws if invalid URL
    } catch {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid URL format" }),
      };
    }

    // Generate unique slug (retry if collision occurs)
    let slug;
    let attempts = 0;
    const MAX_ATTEMPTS = 5;

    do {
      slug = generateSlug();
      attempts++;

      if (attempts > MAX_ATTEMPTS) {
        throw new Error(
          "Failed to generate unique slug after multiple attempts",
        );
      }
    } while (await slugExists(slug));

    // Store in DynamoDB
    const item = {
      slug,
      url,
      createdAt: new Date().toISOString(),
      clicks: 0,
      // TTL: 30 days from now (optional - remove if you want permanent URLs)
      ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    };

    const params = {
      TableName: TABLE_NAME,
      Item: item,
    };

    await dynamodb.send(new PutCommand(params));

    console.log(`Shortened URL created: ${slug} -> ${url}`);

    // Return response
    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        url,
        shortUrl: `https://sho.rt/${slug}`, // We'll replace this with real domain in Phase 4
        createdAt: item.createdAt,
      }),
    };
  } catch (error) {
    console.error("Error in shorten handler:", error);

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
