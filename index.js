import express from "express";
import multer from "multer";
import https from "https";
import { createCanvas, loadImage } from "canvas";
import { QuantizerCelebi, Hct } from "@material/material-color-utilities";
import cors from "cors";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

// Fix for __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create an Express app
const app = express();
const upload = multer();
app.use(express.json());
app.use(cors());

// Serve static files (like index.html)
app.use(express.static(path.join(__dirname, "public")));

// Fetch image from URL using https
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

// Convert image to pixel data
async function getImagePixelData(imageBuffer) {
    const canvas = createCanvas(500, 500); // Resize image to a standard size for processing
    const ctx = canvas.getContext("2d");

    const img = await loadImage(imageBuffer);
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Convert RGBA to ARGB
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
        const opaqueBlack = 0xff000000;
        const argb =
            opaqueBlack | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        pixels.push(argb);
    }

    return pixels;
}

// Quantize and convert to HCT colors
async function generatePalette(imageBuffer, numColors = 16) {
    const pixelData = await getImagePixelData(imageBuffer);

    // Quantize the colors
    const quantizedColors = QuantizerCelebi.quantize(pixelData, 256); // Quantize to a larger color pool

    // Filter and extract the top `numColors` colors
    const palette = [];
    let seenHues = new Set();

    for (const [argb] of quantizedColors) {
        const hctColor = Hct.fromInt(argb);

        // Ensure unique hues by filtering near-duplicate hues
        if (!Array.from(seenHues).some(hue => Math.abs(hue - hctColor.hue) < 10)) {
            seenHues.add(hctColor.hue);
            palette.push({
                hex: `#${argb.toString(16).slice(2)}`,
                hue: hctColor.hue,
                chroma: hctColor.chroma,
                tone: hctColor.tone
            });

            // Stop when we reach the requested number of colors
            if (palette.length >= numColors) break;
        }
    }

    return palette;
}

// API Endpoint
app.post("/generate_palette", upload.none(), async (req, res) => {
    try {
        const imageUrl = req.body.image_url;
        const numColors = parseInt(req.body.num_colors || 16, 10); // Default to 16 colors

        if (!imageUrl) {
            return res.status(400).json({ error: "Image URL is required." });
        }

        const imageBuffer = await fetchImageFromUrl(imageUrl);
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
