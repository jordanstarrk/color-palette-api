import express from "express";
import multer from "multer";
import https from "https";
import sharp from "sharp";
import { createCanvas, loadImage } from "canvas";
import { QuantizerCelebi, Hct } from "@material/material-color-utilities";
import cors from "cors";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const upload = multer();
app.use(express.json());
app.use(cors());

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

    for (const [argb] of quantizedColors) {
        const hctColor = Hct.fromInt(argb);

        // Ensure unique hues by filtering similar hues
        if (!Array.from(seenHues).some(hue => Math.abs(hue - hctColor.hue) < 10)) {
            seenHues.add(hctColor.hue);
            palette.push({
                hex: `#${argb.toString(16).slice(2)}`,
                hue: hctColor.hue,
                chroma: hctColor.chroma,
                tone: hctColor.tone
            });

            if (palette.length >= numColors) break;
        }
    }

    return ensurePaletteSize(palette, numColors); // Ensure we always return `numColors`
}

// API Endpoint
app.post("/generate_palette", upload.none(), async (req, res) => {
    try {
        const imageUrl = req.body.image_url;
        const numColors = parseInt(req.body.num_colors || 16, 10);

        if (!imageUrl) {
            return res.status(400).json({ error: "Image URL is required." });
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
app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
});
