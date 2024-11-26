document.getElementById('paletteForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const imageUrl = document.getElementById('imageUrl').value;
  const numColors = document.getElementById('numColors').value;
  const paletteDiv = document.getElementById('palette');
  const errorMessage = document.getElementById('errorMessage');
  const inputImage = document.getElementById('inputImage');
  const loadingText = document.getElementById('loading');

  // Clear previous results
  paletteDiv.innerHTML = '';
  errorMessage.textContent = '';
  inputImage.style.display = 'none';
  loadingText.style.display = 'flex';

  try {
    // Display the input image
    inputImage.src = imageUrl;
    inputImage.style.display = 'block';

    // Fetch the color palette from the API
    const response = await fetch('https://color-palette-api-b0xm.onrender.com/generate_palette', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        num_colors: parseInt(numColors, 10),
      }),
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const data = await response.json();

    loadingText.style.display = 'none';

    // Render colors
    if (data.palette && data.palette.length > 0) {
      data.palette.forEach(color => {
        const colorBox = document.createElement('div');
        colorBox.className = 'color-box';
        colorBox.style.backgroundColor = color.hex;

        // Display HEX, RGB, and population values
        colorBox.innerHTML = `
          <div class="hex">${color.hex}</div>
          <div>RGB: (${color.red}, ${color.green}, ${color.blue})</div>
          <div>Population: ${color.population}</div>
        `;
        paletteDiv.appendChild(colorBox);
      });
    } else {
      errorMessage.textContent = 'No colors were extracted. Try another image.';
    }
  } catch (err) {
    console.error(err);
    loadingText.style.display = 'none';
    errorMessage.textContent = `Failed to generate palette: ${err.message}`;
  }
});