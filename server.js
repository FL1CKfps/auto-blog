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

// Trending topics for blogs
const TRENDING_TOPICS = [
  'web development',
  'artificial intelligence',
  'machine learning',
  'blockchain',
  'cryptocurrency',
  'cybersecurity',
  'cloud computing',
  'data science',
  'responsive design',
  'UX/UI design',
  'mobile development',
  'DevOps',
  'serverless architecture',
];

// Popular tags to use
const POPULAR_TAGS = [
  'technology',
  'programming',
  'webdev',
  'coding',
  'developer',
  'software',
  'tech',
  'frontend',
  'backend',
  'fullstack',
  'javascript',
  'python',
  'react',
  'node',
  'design',
];

/**
 * Get a random item from an array
 */
function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get multiple random items from an array
 */
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
  
  return { title, content, excerpt };
}

/**
 * Generate a blog post using Gemini API
 */
async function generateBlogContent(topic) {
  const prompt = `
    Search the internet for the most current and latest news about "${topic}".
    Write a comprehensive and engaging blog post based on the latest news, trends, and developments about "${topic}".
    Make sure to include recent events, announcements, or breakthroughs that happened within the last day if possible.
    
    The blog post should be well-structured with clear headings, paragraphs, and lists where appropriate.
    Include relevant technical details, practical examples, current statistics, and recent developments.
    Format the content in HTML.
    
    Also generate a catchy title for the blog post and a brief excerpt (2-3 sentences) that summarizes the article.
    Mention in the content when this was written to emphasize the recency of the information.
    
    Return the response in the following JSON format:
    {
      "title": "The blog post title",
      "content": "The HTML content of the blog post",
      "excerpt": "A brief excerpt summarizing the blog post"
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
 * Get a random image from Unsplash related to a topic
 */
async function getUnsplashImage(topic) {
  try {
    const response = await fetch(
      `${UNSPLASH_API_URL}?query=${encodeURIComponent(topic)}&client_id=${UNSPLASH_ACCESS_KEY}`
    );
    const data = await response.json();
    
    // Check if data and data.urls exist before accessing data.urls.regular
    if (data && data.urls && data.urls.regular) {
      return data.urls.regular;
    } else {
      console.error("Unsplash API response is missing expected properties:", data);
      return `https://source.unsplash.com/random/?${encodeURIComponent(topic)}`;
    }
  } catch (error) {
    console.error("Error fetching image from Unsplash:", error);
    // Return a default image if Unsplash fails
    return `https://source.unsplash.com/random/?${encodeURIComponent(topic)}`;
  }
}

/**
 * Create a new blog post with auto-generated content
 */
async function createAutoBlogPost() {
  try {
    // 1. Pick a random trending topic
    const topic = getRandomItem(TRENDING_TOPICS);
    
    // 2. Generate blog content using Gemini
    const { title, content, excerpt } = await generateBlogContent(topic);
    
    // 3. Get related image from Unsplash
    const coverImage = await getUnsplashImage(topic);
    
    // 4. Pick random tags (3-5)
    const tags = getRandomItems(POPULAR_TAGS, Math.floor(Math.random() * 3) + 3);
    
    // 5. Create the blog post data
    const blogData = {
      title,
      content,
      excerpt,
      coverImage,
      authorName: "AI Blog Assistant",
      authorImage: "https://source.unsplash.com/random/?robot",
      tags,
      slug: title.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-'),
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      publishedAt: admin.firestore.Timestamp.now(),
    };

    // 6. Save to Firestore
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
