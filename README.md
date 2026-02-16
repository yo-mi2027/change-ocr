<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/12X3m5Eb8lvRcHSDhoqxlTcNzUxxEinOe

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## OCR Auto Optimization

The app now uses an automatic Pareto optimizer for OCR quality vs token usage.

- Starts from low-cost profile and escalates only when quality signals are weak.
- Processes image sequences one image per request, while preserving carry-over context between pages.
- Applies lightweight preprocessing (resize + contrast) before image OCR.
- Caches previous OCR results in local storage to avoid repeated token usage.
- Uses fixed prompts per mode (PDF / Image Sequence) for reproducibility and stable token usage.
