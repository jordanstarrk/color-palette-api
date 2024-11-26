// Import dependencies
import express from "express";
import multer from "multer";
import https from "https";
import sharp from "sharp";
import { createCanvas, loadImage } from "canvas";
import { QuantizerCelebi, Hct } from "@material/material-color-utilities";
import cors from "cors";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import Color from "colorjs.io";

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const upload = multer();
app.use(express.json());

// CORS Configuration
const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));

// Explicitly handle preflight OPTIONS requests
app.options("*", cors(corsOptions));

// Add Content Security Policy middleware
app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https:; script-src 'self'; style-src 'self' 'unsafe-inline';");
    next();
});

// Serve static files (like index.html)
app.use(express.static(path.join(__dirname, "public")));

// Supported Image Formats
const SUPPORTED_FORMATS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

// Fetch image from URL
async function fetchImageFromUrl(imageUrl) {
    return new Promise((resolve, reject) => {
        https.get(imageUrl, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to fetch image: ${res.statusMessage}`));
                return;
            }
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks)));
        }).on("error", (err) => reject(err));
    });
}

// Convert unsupported formats to PNG
async function preprocessImage(imageBuffer) {
    const sharpImage = sharp(imageBuffer);
    const metadata = await sharpImage.metadata();

    if (!SUPPORTED_FORMATS.includes(`image/${metadata.format}`)) {
        throw new Error(`Unsupported image format: ${metadata.format}`);
    }

    // Convert WebP, HEIC, or HEIF to PNG for compatibility with canvas
    if (["webp", "heic", "heif"].includes(metadata.format)) {
        return sharpImage.toFormat("png").toBuffer();
    }

    return imageBuffer; // No conversion needed
}

// Resize image to a standard size
async function resizeImage(imageBuffer) {
    return sharp(imageBuffer).resize({ width: 500 }).toBuffer();
}

// Extract pixel data
async function getImagePixelData(imageBuffer) {
    const img = await loadImage(imageBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
        const opaqueBlack = 0xff000000;
        const argb =
            opaqueBlack | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        pixels.push(argb);
    }

    return pixels;
}

// Fallback for fewer colors
function ensurePaletteSize(palette, numColors) {
    if (palette.length >= numColors) {
        return palette.slice(0, numColors);
    }

    const extraColorsNeeded = numColors - palette.length;
    const extraColors = [];

    // Duplicate existing colors if fewer than needed
    for (let i = 0; i < extraColorsNeeded; i++) {
        extraColors.push(palette[i % palette.length]);
    }

    return [...palette, ...extraColors];
}

// Generate palette
async function generatePalette(imageBuffer, numColors = 16) {
    const pixelData = await getImagePixelData(imageBuffer);

    const quantizedColors = QuantizerCelebi.quantize(pixelData, 256); // Quantize to a larger color pool
    const palette = [];
    const seenHues = new Set();

    for (const [argb, population] of quantizedColors) {
        const hctColor = Hct.fromInt(argb);

        if (!Array.from(seenHues).some(hue => Math.abs(hue - hctColor.hue) < 10)) {
            seenHues.add(hctColor.hue);

            const srgbColor = new Color("hct", [hctColor.hue, hctColor.chroma, hctColor.tone]).to("srgb");

            const [r, g, b] = srgbColor.coords.map(channel => Math.min(Math.max(Math.round(channel * 255), 0), 255));

            palette.push({
                hex: srgbColor.toString({ format: "hex" }),
                red: r,
                green: g,
                blue: b,
                population
            });

            if (palette.length >= numColors) break;
        }
    }

    return ensurePaletteSize(palette, numColors);
}

// API Endpoint with Input Validation
app.post("/generate_palette", upload.none(), async (req, res) => {
    try {
        const imageUrl = req.body.image_url;
        const numColors = parseInt(req.body.num_colors || 16, 10);

        // Input validation
        if (!imageUrl || !/^https?:\/\/[^\s/$.?#].[^\s]*$/.test(imageUrl)) {
            return res.status(400).json({ error: "Invalid image URL." });
        }
        
        if (isNaN(numColors) || numColors < 1 || numColors > 100) {
            return res.status(400).json({ error: "Invalid number of colors. Must be between 1 and 100." });
        }

        let imageBuffer = await fetchImageFromUrl(imageUrl);
        imageBuffer = await preprocessImage(imageBuffer);
        imageBuffer = await resizeImage(imageBuffer);

        const palette = await generatePalette(imageBuffer, numColors);
        res.json({ palette });
    } catch (err) {
        console.error(`Error during palette generation: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0"; // Bind to all interfaces for Render
app.listen(PORT, HOST, () => {
    console.log(`API running on http://0.0.0.0:${PORT}`);
});
