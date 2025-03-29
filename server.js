import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import cors from 'cors';

// Load environment variables
dotenv.config();

// Path to service account key file - ensure this file exists
const serviceAccountPath = path.resolve('./serviceAccountKey.json');

try {
  // Initialize Firebase Admin with service account
  if (fs.existsSync(serviceAccountPath)) {
    // Use service account file
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    console.log('Firebase initialized with service account file');
  } else {
    // Fallback to environment variables
    console.log('Service account file not found, using environment variables');
    
    // Create a service account from environment variables
    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
      universe_domain: "googleapis.com"
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    console.log('Firebase initialized with service account from environment variables');
  }
} catch (error) {
  console.error('Error initializing Firebase:', error);
  process.exit(1);
}

const db = admin.firestore();

// Config document in Firestore
const CONFIG_DOC_ID = 'autoBlogConfig';
const CONFIG_COLLECTION = 'systemConfig';

// Blog data configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const UNSPLASH_API_URL = 'https://api.unsplash.com/photos/random';
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const API_SECRET = process.env.API_SECRET;
const WEBSITE_URL = process.env.WEBSITE_URL || 'http://localhost:3000';
const IMGBB_API_KEY = process.env.IMGBB_API_KEY || ''; // Add ImgBB API key

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all routes
app.use(cors({
  origin: ['http://localhost:3000', 'https://zenith-devs.web.app', 'https://zenith-devs.firebaseapp.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-secret']
}));

app.use(express.json());

// Helper functions
function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomItems(arr, count) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

/**
 * Create fallback content when the API fails
 */
function createFallbackContent(topic) {
  return {
    title: `${topic.charAt(0).toUpperCase() + topic.slice(1)} Guide`,
    content: `<h1>${topic.charAt(0).toUpperCase() + topic.slice(1)} Guide</h1><p>This is a comprehensive guide about ${topic}. More content will be available soon.</p>`,
    excerpt: `A comprehensive guide about ${topic}.`,
    primaryKeywords: [topic],
    secondaryKeywords: [],
    suggestedBacklinks: [],
    suggestedUrl: null
  };
}

/**
 * Extract blog data from text
 */
function extractBlogDataFromText(text, topic) {
  try {
    // First try to extract JSON from text - Gemini might wrap the JSON in backticks
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/);
    
    if (!jsonMatch) {
      console.error("Could not extract JSON from Gemini response:", text);
      return extractBlogDataManually(text, topic);
    }
    
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    
    try {
      // Try to parse the JSON directly
      const parsedData = JSON.parse(jsonStr);
      return {
        title: parsedData.title || `${topic.charAt(0).toUpperCase() + topic.slice(1)} Guide`,
        content: parsedData.content || `<p>${text}</p>`,
        excerpt: parsedData.excerpt || `A guide about ${topic}.`,
        // Add additional SEO fields if available
        suggestedUrl: parsedData.suggestedUrl || null,
        primaryKeywords: parsedData.primaryKeywords || [topic],
        secondaryKeywords: parsedData.secondaryKeywords || [],
        suggestedBacklinks: parsedData.suggestedBacklinks || []
      };
    } catch (error) {
      console.log("Direct JSON parsing failed, trying with cleaned JSON");
      
      // Try to clean the JSON string
      let cleanedJsonStr = jsonStr
        // Replace unescaped quotes in strings
        .replace(/([:\s]\s*")([^"]*?)([^\\])"([,\s}])/g, '$1$2$3\\"$4')
        // Remove trailing commas in objects and arrays
        .replace(/,\s*}/g, '}')
        .replace(/,\s*\]/g, ']');
        
      try {
        const parsedData = JSON.parse(cleanedJsonStr);
        return {
          title: parsedData.title || `${topic.charAt(0).toUpperCase() + topic.slice(1)} Guide`,
          content: parsedData.content || `<p>${text}</p>`,
          excerpt: parsedData.excerpt || `A guide about ${topic}.`,
          // Add additional SEO fields if available
          suggestedUrl: parsedData.suggestedUrl || null,
          primaryKeywords: parsedData.primaryKeywords || [topic],
          secondaryKeywords: parsedData.secondaryKeywords || [],
          suggestedBacklinks: parsedData.suggestedBacklinks || []
        };
      } catch (finalError) {
        return extractBlogDataManually(text, topic);
      }
    }
  } catch (error) {
    console.error("Error extracting blog data:", error);
    return extractBlogDataManually(text, topic);
  }
}

/**
 * Last resort method to extract blog data manually from text
 */
function extractBlogDataManually(text, topic) {
  // Extract title from HTML or raw text
  let title = `${topic.charAt(0).toUpperCase() + topic.slice(1)} Guide`;
  const titleMatch = text.match(/<h1[^>]*>(.*?)<\/h1>/) || text.match(/"title"\s*:\s*"([^"]+)"/);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim();
  }
  
  // Extract or reconstruct content
  let content = `<h1>${topic.charAt(0).toUpperCase() + topic.slice(1)}</h1><div>${text}</div>`;
  
  // Try to find HTML content directly
  const htmlStartMatch = text.match(/<([a-z][a-z0-9]*)\b[^>]*>/i);
  if (htmlStartMatch) {
    const htmlContent = text.slice(text.indexOf(htmlStartMatch[0]));
    // Clean up HTML by removing code blocks and other non-HTML elements
    const cleanedHtml = htmlContent.replace(/```[\s\S]*?```/g, '').trim();
    if (cleanedHtml.length > 0) {
      content = cleanedHtml;
    }
  }
  
  // Extract excerpt from first paragraph or raw text
  let excerpt = `A guide about ${topic}.`;
  const excerptMatch = text.match(/"excerpt"\s*:\s*"([^"]+)"/) || text.match(/<p[^>]*>(.*?)<\/p>/);
  if (excerptMatch && excerptMatch[1]) {
    const rawExcerpt = excerptMatch[1].replace(/<[^>]+>/g, '').trim();
    excerpt = rawExcerpt.length > 150 ? rawExcerpt.substring(0, 147) + '...' : rawExcerpt;
  }
  
  return { 
    title, 
    content, 
    excerpt,
    primaryKeywords: [topic],
    secondaryKeywords: [],
    suggestedBacklinks: [],
    suggestedUrl: null
  };
}

/**
 * Get trending topics via Gemini
 */
async function getTrendingTopics() {
  try {
    const prompt = `
      Search the web for the most current popular and trending tech topics today.
      Return exactly 5 trending tech topics that would make interesting blog posts.
      The topics should be specific enough to generate a good blog post about.
      Format your response as a JSON array of strings only, with no explanations.
      Example: ["web3 developments", "AI chatbot innovations", "cybersecurity trends", "cloud computing advances", "mobile development frameworks"]
    `;

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      console.error("Gemini API error when getting trending topics:", data.error);
      return ['web development', 'artificial intelligence', 'machine learning', 'cloud computing', 'cybersecurity'];
    }
    
    // Extract text from the response
    const content = data.candidates[0].content;
    const parts = content.parts;
    
    if (!parts || !parts.length || !parts[0].text) {
      console.error("No text content in Gemini trending topics response");
      return ['web development', 'artificial intelligence', 'machine learning', 'cloud computing', 'cybersecurity'];
    }
    
    const text = parts[0].text;
    
    try {
      // Try to parse JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const topics = JSON.parse(jsonMatch[0]);
        console.log("Found trending topics:", topics);
        return topics;
      } else {
        console.log("Could not extract JSON array from Gemini response, using text as-is");
        // Split the text by commas or newlines if not valid JSON
        const topics = text.split(/,|\n/).map(t => t.trim()).filter(t => t.length > 0);
        return topics.slice(0, 5); // Return up to 5 topics
      }
    } catch (error) {
      console.error("Error parsing trending topics:", error);
      return ['web development', 'artificial intelligence', 'machine learning', 'cloud computing', 'cybersecurity'];
    }
  } catch (error) {
    console.error("Error getting trending topics:", error);
    return ['web development', 'artificial intelligence', 'machine learning', 'cloud computing', 'cybersecurity'];
  }
}

/**
 * Get relevant tags for a topic via Gemini
 */
async function getRelevantTags(topic) {
  try {
    const prompt = `
      Generate 5 relevant and popular tags/hashtags for a tech blog post about "${topic}".
      Return them as a JSON array of strings only, with no explanations.
      Tags should be short (1-2 words) and popular for tech content.
      Example: ["javascript", "webdev", "programming", "technology", "coding"]
    `;

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      console.error("Gemini API error when getting tags:", data.error);
      return ['technology', 'coding', 'programming', 'webdev', 'tech'];
    }
    
    // Extract text from the response
    const content = data.candidates[0].content;
    const parts = content.parts;
    
    if (!parts || !parts.length || !parts[0].text) {
      console.error("No text content in Gemini tags response");
      return ['technology', 'coding', 'programming', 'webdev', 'tech'];
    }
    
    const text = parts[0].text;
    
    try {
      // Try to parse JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const tags = JSON.parse(jsonMatch[0]);
        console.log(`Found tags for ${topic}:`, tags);
        return tags;
      } else {
        console.log("Could not extract JSON array from Gemini response, using text as-is");
        // Split the text by commas or newlines if not valid JSON
        const tags = text.split(/,|\n/).map(t => t.trim()).filter(t => t.length > 0);
        return tags.slice(0, 5); // Return up to 5 tags
      }
    } catch (error) {
      console.error("Error parsing tags:", error);
      return ['technology', 'coding', 'programming', 'webdev', 'tech'];
    }
  } catch (error) {
    console.error("Error getting tags:", error);
    return ['technology', 'coding', 'programming', 'webdev', 'tech'];
  }
}

/**
 * Generate a blog post using Gemini API
 */
async function generateBlogContent(topic) {
  const prompt = `
    Search the internet for the most current and latest news about "${topic}".
    Write a comprehensive and engaging blog post based on the latest news, trends, and developments about "${topic}".
    
    COMPREHENSIVE SEO OPTIMIZATION GUIDELINES:
    1. Create a compelling, keyword-rich title (60-65 characters) that includes the primary keyword "${topic}" near the beginning
    2. Create a strong meta description (150-155 characters) as the excerpt that includes primary and secondary keywords and a clear call-to-action
    3. Structure content with proper heading hierarchy (H1 for title, H2 for main sections, H3 for subsections)
    4. Include semantic HTML5 markup with article, section, nav, aside, and header tags where appropriate
    5. Ensure keyword density of 1-2% for primary keywords (natural usage, not forced)
    6. Add long-tail variations of the main keyword throughout (e.g., "how to...", "best ways to...", "top tools for...")
    7. Include at least 8-10 related LSI keywords (Latent Semantic Indexing) for deeper topical coverage
    8. Create an FAQ section with 5-7 common questions about "${topic}" with detailed answers using schema.org/FAQPage markup
    9. Add schema.org/Article markup with datePublished, dateModified, author, publisher details
    10. Include a featured snippet opportunity (definition, steps, list, or table) optimized for position zero
    11. Ensure content length is 1500-2000+ words for comprehensive coverage
    12. Add internal linking opportunities to 3-5 related topics with descriptive anchor text
    13. Include outbound links to 2-3 authoritative sources with relevant statistics
    14. Optimize image suggestions with descriptive filenames, alt text, and captions
    15. Create content that satisfies search intent (informational, navigational, transactional, or commercial)
    16. Use short paragraphs (3-4 sentences), bullet points, and numbered lists for better readability and featured snippet opportunities
    17. Include target keywords in the first 100 words and last 100 words of the content
    18. Add TL;DR summary at the beginning for featured snippet optimization
    19. Include a table of contents with anchor links to improve navigation and SEO
    20. Implement proper keyword-focused URL structure suggestion

    Content Structure Requirements:
    - Compelling introduction with a hook and clear value proposition
    - A brief "TL;DR" summary that targets featured snippets
    - Table of contents with anchor links
    - Well-structured body with keyword-optimized H2 and H3 headings
    - Practical examples, case studies, or data points
    - Visual content suggestions (infographics, charts, images) with optimization notes
    - FAQ section with schema markup
    - Conclusion with key takeaways and next steps
    - Call-to-action that encourages engagement
    
    Format the content in HTML with proper semantic tags, emphasizing structured data markup.
    Include both visible and structured data (schema.org) markup.
    Mention in the content when this was written to emphasize the recency of the information.
    
    Return the response in the following JSON format:
    {
      "title": "SEO-optimized article title including primary keyword",
      "content": "The complete HTML content with proper semantic markup and structured data",
      "excerpt": "SEO-optimized meta description with primary keyword and call-to-action",
      "suggestedUrl": "keyword-rich-url-structure-for-the-post",
      "primaryKeywords": ["list", "of", "primary", "keywords"],
      "secondaryKeywords": ["list", "of", "secondary", "keywords"],
      "suggestedBacklinks": ["list", "of", "suggested", "outreach", "targets"]
    }
  `;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    
    // Check if the response contains an error
    if (data.error) {
      console.error("Gemini API error:", data.error);
      throw new Error(`Gemini API error: ${JSON.stringify(data.error)}`);
    }
    
    // Check if the response has the expected structure
    if (!data.candidates || !data.candidates.length || !data.candidates[0].content) {
      console.error("Unexpected Gemini API response structure:", JSON.stringify(data));
      return createFallbackContent(topic);
    }
    
    // Extract text from the response
    const content = data.candidates[0].content;
    const parts = content.parts;
    
    if (!parts || !parts.length || !parts[0].text) {
      console.error("No text content in Gemini response:", JSON.stringify(content));
      return createFallbackContent(topic);
    }
    
    const text = parts[0].text;
    
    // Try to extract and parse JSON from the response
    return extractBlogDataFromText(text, topic);
    
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return createFallbackContent(topic);
  }
}

/**
 * Upload an image to ImgBB from a URL
 */
async function uploadToImgBB(imageUrl, topic) {
  try {
    console.log(`Uploading image to ImgBB for topic: ${topic}`);
    
    if (!IMGBB_API_KEY) {
      console.warn('ImgBB API key not set, skipping upload');
      return imageUrl; // Return original URL if no API key
    }
    
    // Get the image data from the URL
    console.log(`Fetching image data from: ${imageUrl.substring(0, 50)}...`);
    const imageResponse = await fetch(imageUrl);
    
    if (!imageResponse.ok) {
      console.error(`Failed to fetch image data: ${imageResponse.status} ${imageResponse.statusText}`);
      return imageUrl; // Return original URL if fetch fails
    }
    
    // Convert to blob
    const imageBlob = await imageResponse.blob();
    
    // Create form data
    const formData = new FormData();
    formData.append('image', imageBlob);
    formData.append('key', IMGBB_API_KEY);
    formData.append('name', `auto_blog_${topic.replace(/\s+/g, '_')}_${Date.now()}`);
    
    // Upload to ImgBB
    console.log('Uploading to ImgBB...');
    const uploadResponse = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: formData
    });
    
    if (!uploadResponse.ok) {
      console.error(`ImgBB upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
      return imageUrl; // Return original URL if upload fails
    }
    
    const uploadData = await uploadResponse.json();
    
    if (uploadData.success) {
      console.log(`ImgBB upload successful, URL: ${uploadData.data.url.substring(0, 50)}...`);
      return uploadData.data.url; // Return the ImgBB URL
    } else {
      console.error('ImgBB upload failed:', uploadData.error);
      return imageUrl; // Return original URL if API response indicates failure
    }
  } catch (error) {
    console.error('Error uploading to ImgBB:', error);
    return imageUrl; // Return original URL if anything goes wrong
  }
}

/**
 * Get a random image from Unsplash related to a topic
 */
async function getUnsplashImage(topic) {
  try {
    console.log(`Fetching image from Unsplash for topic: ${topic}`);
    console.log(`Using Unsplash API key: ${UNSPLASH_ACCESS_KEY ? UNSPLASH_ACCESS_KEY.substring(0, 5) + '...' : 'not set'}`);
    
    const url = `${UNSPLASH_API_URL}?query=${encodeURIComponent(topic)}&client_id=${UNSPLASH_ACCESS_KEY}`;
    console.log(`Unsplash API URL: ${url.replace(UNSPLASH_ACCESS_KEY, '***')}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`Unsplash API returned status ${response.status}: ${response.statusText}`);
      return getFallbackImage(topic);
    }
    
    const data = await response.json();
    console.log(`Unsplash response status: ${response.status}, has urls: ${data && data.urls ? 'yes' : 'no'}`);
    
    // Check if data and data.urls exist before accessing data.urls.regular
    if (data && data.urls && data.urls.regular) {
      console.log(`Found image URL: ${data.urls.regular.substring(0, 50)}...`);
      
      // Upload to ImgBB for more reliable storage
      const imgbbUrl = await uploadToImgBB(data.urls.regular, topic);
      return imgbbUrl;
    } else {
      console.error("Unsplash API response is missing expected properties:", JSON.stringify(data).substring(0, 200));
      return getFallbackImage(topic);
    }
  } catch (error) {
    console.error("Error fetching image from Unsplash:", error);
    return getFallbackImage(topic);
  }
}

/**
 * Get fallback image when Unsplash fails
 */
function getFallbackImage(topic) {
  // Try different options for fallback images
  const options = [
    // Option 1: Use the Unsplash source API (doesn't require API key)
    `https://source.unsplash.com/random/?${encodeURIComponent(topic)}`,
    
    // Option 2: Use Pexels placeholder (doesn't require API key)
    `https://images.pexels.com/photos/546819/pexels-photo-546819.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1`,
    
    // Option 3: Use Picsum placeholder
    `https://picsum.photos/800/600`,
    
    // Option 4: Last resort - static placeholder
    `https://via.placeholder.com/800x600.png?text=${encodeURIComponent(topic)}`
  ];
  
  // Select the first option as default
  const fallbackUrl = options[0];
  console.log(`Using fallback image URL: ${fallbackUrl}`);
  
  // Try to upload the fallback image to ImgBB as well
  // This is wrapped in a try/catch just to be safe
  try {
    if (IMGBB_API_KEY) {
      return uploadToImgBB(fallbackUrl, topic);
    }
  } catch (error) {
    console.error("Error uploading fallback image to ImgBB:", error);
  }
  
  return fallbackUrl;
}

/**
 * Create a new blog post with auto-generated content
 */
async function createAutoBlogPost() {
  try {
    // 1. Get trending topics
    const trendingTopics = await getTrendingTopics();
    
    // 2. Pick a random trending topic
    const topic = getRandomItem(trendingTopics);
    console.log(`Creating new blog post on topic: ${topic}`);
    
    // 3. Generate blog content using Gemini
    const { 
      title, 
      content, 
      excerpt, 
      suggestedUrl, 
      primaryKeywords, 
      secondaryKeywords,
      suggestedBacklinks 
    } = await generateBlogContent(topic);
    
    // 4. Get related image from Unsplash - wrapped in try/catch to continue even if it fails
    let coverImage;
    try {
      coverImage = await getUnsplashImage(topic);
    } catch (imageError) {
      console.error("Failed to get image, using fallback:", imageError);
      coverImage = getFallbackImage(topic);
    }
    
    // 5. Get relevant tags for the topic
    const tags = await getRelevantTags(topic);
    
    // 6. Create the blog post data with enhanced SEO fields
    const blogData = {
      title,
      content,
      excerpt,
      coverImage,
      authorName: "AI Blog Assistant",
      authorImage: "https://source.unsplash.com/random/?robot",
      tags,
      // Use the suggested URL slug if available, otherwise generate from title
      slug: suggestedUrl || title.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-'),
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      publishedAt: admin.firestore.Timestamp.now(),
      // Add additional SEO fields
      seoData: {
        primaryKeywords: primaryKeywords || [topic],
        secondaryKeywords: secondaryKeywords || [],
        suggestedBacklinks: suggestedBacklinks || [],
        focusKeyword: primaryKeywords && primaryKeywords.length > 0 ? primaryKeywords[0] : topic,
        readabilityScore: 'A', // Placeholder, could be calculated
        wordCount: content.split(/\s+/).length,
        lastUpdated: new Date().toISOString()
      }
    };

    console.log(`Blog data prepared, saving to Firestore...`);
    console.log(`Title: ${title}`);
    console.log(`Excerpt: ${excerpt.substring(0, 100)}...`);
    console.log(`Cover image: ${coverImage.substring(0, 50)}...`);
    console.log(`Tags: ${tags.join(', ')}`);
    console.log(`Primary keywords: ${blogData.seoData.primaryKeywords.join(', ')}`);

    // 7. Save to Firestore
    const blogsRef = db.collection("blogs");
    const docRef = await blogsRef.add(blogData);
    console.log(`New blog post created with ID: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    console.error("Error creating auto blog post:", error);
    throw error;
  }
}

/**
 * Helper function to get current config
 */
async function getAutoBlogConfig() {
  try {
    const configRef = db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID);
    const configSnap = await configRef.get();
    
    if (configSnap.exists) {
      return configSnap.data();
    } else {
      // Default config if it doesn't exist
      const defaultConfig = {
        newsUpdatesEnabled: false,
        autoScheduleEnabled: false,
        scheduleIntervalHours: 24,
        lastNewsPost: null,
        lastRegularPost: null,
        updatedAt: admin.firestore.Timestamp.now()
      };
      
      // Create the default config
      await configRef.set(defaultConfig);
      return defaultConfig;
    }
  } catch (error) {
    console.error('Error getting auto blog config:', error);
    throw error;
  }
}

/**
 * Update auto blog config with provided updates
 */
async function updateAutoBlogConfig(updates) {
  try {
    const configRef = db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID);
    
    // Add timestamp to updates
    updates.updatedAt = admin.firestore.Timestamp.now();
    
    // Update the config
    await configRef.update(updates);
    
    // Return the updated config
    const updatedConfig = await configRef.get();
    return updatedConfig.data();
  } catch (error) {
    console.error('Error updating auto blog config:', error);
    throw error;
  }
}

// Schedule Management
let newsInterval = null;
let regularInterval = null;

/**
 * Start the news post schedule
 */
async function startNewsSchedule() {
  try {
    console.log('Starting news schedule...');
    // Create a post right away
    await createAutoBlogPost();
    
    await updateAutoBlogConfig({ 
      lastNewsPost: admin.firestore.Timestamp.now() 
    });
    
    // Schedule news posts every minute
    newsInterval = setInterval(async () => {
      try {
        // Only create post if it's still enabled
        const config = await getAutoBlogConfig();
        if (!config.newsUpdatesEnabled) {
          console.log('News updates disabled, stopping schedule');
          clearInterval(newsInterval);
          newsInterval = null;
          return;
        }
        
        const blogId = await createAutoBlogPost();
        console.log(`Created news post with ID: ${blogId}`);
        await updateAutoBlogConfig({ lastNewsPost: admin.firestore.Timestamp.now() });
      } catch (error) {
        console.error("Error in news post interval:", error);
      }
    }, 60 * 1000); // Every minute
  } catch (error) {
    console.error('Error starting news schedule:', error);
    throw error;
  }
}

/**
 * Start the regular post schedule
 */
async function startRegularSchedule(intervalHours) {
  try {
    console.log(`Starting regular schedule every ${intervalHours} hours...`);
    // Create a post right away
    await createAutoBlogPost();
    
    await updateAutoBlogConfig({ 
      lastRegularPost: admin.firestore.Timestamp.now() 
    });
    
    // Schedule regular posts at specified interval
    regularInterval = setInterval(async () => {
      try {
        // Only create post if it's still enabled
        const config = await getAutoBlogConfig();
        if (!config.autoScheduleEnabled) {
          console.log('Regular schedule disabled, stopping');
          clearInterval(regularInterval);
          regularInterval = null;
          return;
        }
        
        const blogId = await createAutoBlogPost();
        console.log(`Created regular post with ID: ${blogId}`);
        await updateAutoBlogConfig({ lastRegularPost: admin.firestore.Timestamp.now() });
      } catch (error) {
        console.error("Error in regular post interval:", error);
      }
    }, intervalHours * 60 * 60 * 1000); // Convert hours to ms
  } catch (error) {
    console.error('Error starting regular schedule:', error);
    throw error;
  }
}

/**
 * Initialize schedules based on config
 */
async function initializeSchedules() {
  try {
    // Get current config
    const config = await getAutoBlogConfig();
    
    // Start schedules if enabled
    if (config.newsUpdatesEnabled) {
      console.log("Starting news updates schedule");
      await startNewsSchedule();
    }
    
    if (config.autoScheduleEnabled) {
      console.log("Starting regular post schedule");
      await startRegularSchedule(config.scheduleIntervalHours || 24);
    }
  } catch (error) {
    console.error("Error initializing schedules:", error);
  }
}

// API Routes

// Route to manually create a blog post
app.post('/api/create-post', async (req, res) => {
  // Verify API secret
  const secret = req.headers['x-api-secret'];
  if (secret !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized. Invalid API secret.' });
  }
  
  try {
    const postType = req.body.postType || 'regular';
    
    if (postType === 'news') {
      // Check if news updates are enabled
      const newsConfig = await getAutoBlogConfig();
      if (newsConfig.newsUpdatesEnabled) {
        const newsBlogId = await createAutoBlogPost();
        await updateAutoBlogConfig({ lastNewsPost: admin.firestore.Timestamp.now() });
        return res.json({ success: true, blogId: newsBlogId });
      } else {
        return res.status(400).json({ error: 'News updates are disabled' });
      }
    } else if (postType === 'regular') {
      // Check if auto schedule is enabled
      const regularConfig = await getAutoBlogConfig();
      if (regularConfig.autoScheduleEnabled) {
        const regularBlogId = await createAutoBlogPost();
        await updateAutoBlogConfig({ lastRegularPost: admin.firestore.Timestamp.now() });
        return res.json({ success: true, blogId: regularBlogId });
      } else {
        return res.status(400).json({ error: 'Auto schedule is disabled' });
      }
    } else {
      return res.status(400).json({ error: 'Invalid post type' });
    }
  } catch (error) {
    console.error('Error creating post:', error);
    return res.status(500).json({ error: 'Server error creating post' });
  }
});

// Route to get config
app.get('/api/config', async (req, res) => {
  try {
    const config = await getAutoBlogConfig();
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error getting config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route to update config and start/stop schedules
app.post('/api/config', async (req, res) => {
  try {
    const { newsUpdatesEnabled, autoScheduleEnabled, scheduleIntervalHours } = req.body;
    const updates = {};
    
    // Update newsUpdatesEnabled if provided
    if (typeof newsUpdatesEnabled === 'boolean') {
      updates.newsUpdatesEnabled = newsUpdatesEnabled;
      
      if (newsUpdatesEnabled) {
        // Start news schedule if newly enabled
        await startNewsSchedule();
      } else if (newsInterval) {
        // Stop news schedule if disabled
        clearInterval(newsInterval);
        newsInterval = null;
      }
    }
    
    // Update autoScheduleEnabled if provided
    if (typeof autoScheduleEnabled === 'boolean') {
      updates.autoScheduleEnabled = autoScheduleEnabled;
      
      if (autoScheduleEnabled) {
        // Start regular schedule if newly enabled
        const hours = scheduleIntervalHours || 
                     (await getAutoBlogConfig()).scheduleIntervalHours || 
                     24;
        await startRegularSchedule(hours);
      } else if (regularInterval) {
        // Stop regular schedule if disabled
        clearInterval(regularInterval);
        regularInterval = null;
      }
    }
    
    // Update scheduleIntervalHours if provided
    if (typeof scheduleIntervalHours === 'number' && scheduleIntervalHours > 0) {
      updates.scheduleIntervalHours = scheduleIntervalHours;
      
      // Restart regular schedule with new interval if enabled
      if (autoScheduleEnabled !== false && 
         (autoScheduleEnabled === true || (await getAutoBlogConfig()).autoScheduleEnabled)) {
        if (regularInterval) {
          clearInterval(regularInterval);
          regularInterval = null;
        }
        await startRegularSchedule(scheduleIntervalHours);
      }
    }
    
    // Save updates to Firestore
    const config = await updateAutoBlogConfig(updates);
    
    res.json({ success: true, message: 'Configuration updated successfully', config });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook to allow Next.js to toggle features
app.post('/api/webhook', async (req, res) => {
  try {
    // Verify API secret
    const providedSecret = req.query.key || req.headers['x-api-secret'];
    
    if (providedSecret !== API_SECRET) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    // Process the webhook based on action
    const { action, ...data } = req.body;
    
    switch (action) {
      case 'getConfig':
        const config = await getAutoBlogConfig();
        return res.json({ success: true, config });
        
      case 'updateConfig':
        const updatedConfig = await updateAutoBlogConfig(data.updates || {});
        return res.json({ success: true, config: updatedConfig });
        
      case 'createPost':
        const blogId = await createAutoBlogPost();
        return res.json({ success: true, blogId });
        
      case 'createNewsPost':
        // Check if news updates are enabled
        const newsConfig = await getAutoBlogConfig();
        if (newsConfig.newsUpdatesEnabled) {
          const newsBlogId = await createAutoBlogPost();
          await updateAutoBlogConfig({ lastNewsPost: admin.firestore.Timestamp.now() });
          return res.json({ success: true, blogId: newsBlogId });
        } else {
          return res.json({ success: false, error: 'News updates not enabled' });
        }
        
      case 'createRegularPost':
        // Check if regular posts are enabled
        const regularConfig = await getAutoBlogConfig();
        if (regularConfig.autoScheduleEnabled) {
          const regularBlogId = await createAutoBlogPost();
          await updateAutoBlogConfig({ lastRegularPost: admin.firestore.Timestamp.now() });
          return res.json({ success: true, blogId: regularBlogId });
        } else {
          return res.json({ success: false, error: 'Regular schedule not enabled' });
        }
        
      default:
        return res.status(400).json({ success: false, error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start the server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Initializing auto-posting schedules...');
  
  // Initialize schedules based on saved config
  await initializeSchedules();
  
  console.log(`Server ready! Visit http://localhost:${PORT}/api/config to see the current configuration`);
});

// Clean shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  
  if (newsInterval) {
    clearInterval(newsInterval);
  }
  
  if (regularInterval) {
    clearInterval(regularInterval);
  }
  
  console.log('Cleared all intervals');
  process.exit(0);
}); 
