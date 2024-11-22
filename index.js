import express from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';
import { QuantizerCelebi } from '@material/material-color-utilities';
import cors from 'cors'; 

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer();

// Enable CORS
app.use(
    cors({
        origin: '*', // Replace '*' with your frontend's URL for stricter security
        methods: ['GET', 'POST', 'OPTIONS'], // Allow specific HTTP methods
        allowedHeaders: ['Content-Type'], // Allow specific headers
    })
);

// Explicitly handle preflight OPTIONS requests
app.options('*', cors());

// Parse JSON bodies
app.use(express.json());

// Serve static files (index.html and related assets)
app.use(express.static(path.join(__dirname, 'public')));

// Fetch image from URL
async function fetchImageFromUrl(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    return await response.buffer();
}

// Preprocess image
async function preprocessImage(imageBuffer) {
    const { data, info } = await sharp(imageBuffer)
        .resize(200, 200, { fit: 'inside' })
        .removeAlpha()
        .toColorspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });

    console.log(`Processed image dimensions: ${info.width}x${info.height}`);
    console.log(`Sample pixel data:`, data.slice(0, 15)); // Debugging pixel data
    return data;
}

// Extract colors
async function extractColors(imageBuffer, numColors) {
    const pixelData = await preprocessImage(imageBuffer);

    // Quantize the colors
    const quantizedColors = QuantizerCelebi.quantize(pixelData, 256);
    console.log('Quantized colors:', quantizedColors);

    // Convert Map to Array and sort by frequency
    const rawColors = Array.from(quantizedColors.keys())
        .sort((a, b) => quantizedColors.get(b) - quantizedColors.get(a))
        .slice(0, numColors); // Limit to the top `numColors`

    console.log('Raw colors:', rawColors);

    // Convert ARGB to HEX
    const hexColors = rawColors.map(
        (argb) => `#${parseInt(argb).toString(16).padStart(8, '0').slice(2)}`
    );

    console.log('HEX colors:', hexColors);
    return hexColors;
}

// API Endpoint
app.post('/generate_palette', upload.single('image'), async (req, res) => {
    try {
        let imageBuffer;

        if (req.file) {
            imageBuffer = req.file.buffer;
        } else if (req.body.image_url) {
            imageBuffer = await fetchImageFromUrl(req.body.image_url);
        } else {
            return res.status(400).json({ error: 'Either an image file or image_url is required.' });
        }

        const numColors = parseInt(req.body.num_colors || 10, 10);
        const palette = await extractColors(imageBuffer, numColors);

        res.json({ palette });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Handle invalid routes
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Start the server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
});
