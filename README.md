# Diffraction & Spectra Studio

A free, browser-based workspace for building publication-ready XRD, Raman and IR figures.

[Open the app](https://make-figure.vercel.app/) · [Report a problem](https://github.com/MDES-CEA/Make_figure/issues/new?template=bug_report.yml)

![XRD workspace with 6 paterns and 3 phases references](docs/screenshots/xrd-workspace.png)
![Raman workspace with 6 patterns and 3 phase references](docs/screenshots/Raman-workspace.png)
![IR workspace with 6 patterns and 3 phase references](docs/screenshots/IR-workspace.png)

## What it does

Diffraction & Spectra Studio brings data import, signal processing, reference management, figure editing and export into one interface. It supports English and French and runs locally in the browser: imported data are not uploaded to a server.

- Work in dedicated **XRD**, **Raman** and **IR** spaces within the same project.
- Stack, overlay or compare several acquisitions.
- Smooth, normalise and correct baselines; detect, fit and track peaks.
- Add XRD phase references, Raman reference spectra and IR band lists.
- Edit curve labels, annotations, text size, weight, colours and line styles directly on the figure or from the option panels.
- Preview the normalised output before exporting to **PNG**, **TIFF**, **SVG** or **PDF**.
- Save and restore complete projects as JSON sessions.

The built-in sample data provide a quick way to explore the XRD workflow without preparing files first.

## Supported inputs

| Input | Formats |
| --- | --- |
| Acquisitions | `.xy`, `.txt`, `.csv`, `.dat`, `.xrdml`, Bruker OPUS XML and binary OPUS files (`.0`, `.1`, `.2`, `.3`, `.opus`) |
| Phase and reference data | `.dif`, `.cif`, `.txt`, `.csv`, `.dat` |
| Saved projects | `.json` sessions exported by the application |

Files can be selected from the import controls or dragged directly into the workspace. Recognised XRD, RRUFF Raman and OPUS files are routed to the appropriate analysis space.


## Walkthrough of a project: 

1. Import your data into the app by dragging your file in the window or pressing "import data" in the "Curves" window on the left panel.

   -> Your data should be shown in a graph on the middle window, by pressing the "Processing" button, a right panel opens with several options and treatment for your data.
   
   - Preprocessing allow you to smooth and trim the peaks with "percentile clipping", you can also normalize your data with different laws (especially usefull if you have several spectra or very high peak)
   - Baseline correction (rolling minimum, SNIP, rubber band, polynomial law, ALS)
   - A peak detection tool with different parameters and an export option
   - Deconvolution tool for multi peak fitting
   - You can also : align a serie of acquisition, change instrument and radiation, add an instrumental correction, fit single peaks

3. Import your reference phases in the "References" window on the left panel in .dif, .cif, .txt, .csv, .dat or manually enter the peak with "add manually"

   -> The reference panel on the left allow you to add those references onto the graph, either with phase annotation in a dedicated panel on the top of your figure, directly put it on the figure and control stick height,    peak values, line width (these control are also available directly on the figure after adding the references), or in a dedicated panel on the bottom of the figure.

   Layout control are also possible directly on the figure and by the addition of notes (left pannel). Notes can be added anywhere on the graph, options are located by selecting a note (notes added are automatically          selected) and going into the "Selection" window on the right panel.

![Phase annotation options](docs/screenshots/phase-annotations.png) ![reference on figure options](docs/screenshots/reference-on-fig.png) ![reference pannel options](docs/screenshots/ref-panel.png)

![Phase-reference cards and XRD processing controls](docs/screenshots/phase-references-and-processing.png)

4. Tune the layout with the "Appearance" window on the right panel.

   ->You can: change the text and axes, the Xmax and Xmin (you can also do this by dragging the resize strip above the figure), add a grid, change tick steps, add a secondary axis, a zoom inset), change the layout when you have a serie of acquisition (stacking, waterfall, overlay), adjust the typography of all the text (police, bold, size), adjust line width and opacity, change line colors, add an X axis break, save you style to reuse it later. 

![Appearances window](docs/screenshots/Appearance.png)

5. Export your figure

   -> Adjust the quality and scale of the PNG and PDF/TIFF file in the "Export" window on the right panel and export by clicking "Preview export", choosing your format and clicking "Export". You can also save the data and project in CSV. The preview uses the same normalised SVG as the exported file, independently of the editor zoom. The preview also reports the output dimensions, background and curve line width before export.
   
![Export options](docs/screenshots/Figure-export.png)
![Export options](docs/screenshots/preview-export.png)   

**Your session is saved in browser at all time, you can also save your session in a .json file and upload it later to keep working on your project. You upload a .json by clicking the "import a JSON" button next to "active project on the top right or pressing Ctrl+O**

![import options](docs/screenshots/import.png) 

## Run locally

Requirements: Node.js 18 or later and npm.

```bash
git clone https://github.com/MDES-CEA/Make_figure.git
cd Make_figure
npm install
npm run dev
```

Vite prints the local URL after startup.

## Development

```bash
npm test
npm run build
npm run preview
```

The application is built with React, Vite and Tailwind CSS v4. It is a static client-side application and does not require a backend.

Interface changes are reviewed against the [interface principles](docs/interface-principles.md), including limits on decorative effects, redundant copy and speculative features.

## Feedback

Use the in-app **Report a problem** button or [open a GitHub issue](https://github.com/MDES-CEA/Make_figure/issues/new?template=bug_report.yml). Include the active workspace, browser, steps to reproduce and a screenshot when possible.
