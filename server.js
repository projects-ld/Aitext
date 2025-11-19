import express from "express";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";
import { OpenAI } from "openai";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

const client = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
  defaultHeaders: { "api-key": process.env.AZURE_OPENAI_KEY },
  defaultQuery: { "api-version": "2024-02-15-preview" },
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("."));

app.post("/analyze", upload.single("cvfile"), async (req, res) => {
  try {
    let text = req.body.text;
    if (req.file) text = fs.readFileSync(req.file.path, "utf8");

    // ✅ تحليل السيرة وطلب JSON من GPT
    const analysisResponse = await client.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `
You are an HR assistant. Analyze this resume and respond in JSON format like:
{
  "summary": "short summary here",
  "strengths": ["strength1", "strength2", "strength3"],
  "suggestedRoles": ["role1", "role2"]
}. 
Use clear sentences, no bullets, no symbols.
          `,
        },
        { role: "user", content: text },
      ],
    });

    const analysisJson = JSON.parse(analysisResponse.choices[0].message.content);
    const summary = analysisJson.summary || "";
    const strengths = (analysisJson.strengths || []).join("<br>");
    const suggestedRoles = (analysisJson.suggestedRoles || []).join("<br>") || "Software Developer, Data Analyst, Frontend Engineer";

    // ✅ استخراج الكلمات المفتاحية
    const keywordsResponse = await client.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "Extract main technical keywords (like developer, designer, engineer, AI, data) from this text. Respond with comma-separated keywords only.",
        },
        { role: "user", content: text },
      ],
    });

    const keywords = keywordsResponse.choices[0].message.content
      .replace(/[*\-•]/g, "")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 3);

    console.log("🎯 Extracted Keywords:", keywords);

    // ✅ جلب الوظائف الحقيقية
    let jobs = [];
    try {
      const jsearchRes = await axios.get("https://jsearch.p.rapidapi.com/search", {
        params: { query: keywords[0], page: "1", num_pages: "1"},
        headers: {
          "X-RapidAPI-Key": process.env.RAPID_API_KEY,
          "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
        },
      });

      const data = jsearchRes.data.data || [];

      // ✅ تقييم match % لكل وظيفة باستخدام gpt-4.1
      for (const job of data.slice(0, 10)) {
        const jobText = `${job.job_title || ""} ${job.job_description || ""}`;

        const matchResponse = await client.chat.completions.create({
          messages: [
            {
              role: "system",
              content: "You are an HR assistant. Evaluate how well a resume matches a job description.",
            },
            {
              role: "user",
              content: `Resume: ${text}
Job Description: ${jobText}
Rate the match as a percentage (0-100%) based on skills and relevance. Respond with only the number.`,
            },
          ],
        });

        let matchPercent = parseInt(matchResponse.choices[0].message.content);
        if (isNaN(matchPercent)) matchPercent = 0;

        jobs.push({
          title: job.job_title,
          company: job.employer_name || "Unknown",
          location: `${job.job_city || "Unknown City"}, ${job.job_country || "Unknown Country"}`,
          url: job.job_apply_link,
          match: matchPercent,
        });
      }
    } catch (err) {
      console.error("⚠️ Job API error:", err.message);
    }

    // ✅ صفحة العرض
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>CV Analysis & Job Matches</title>
      <style>
        body { font-family: 'Segoe UI', sans-serif; background: #f9fafb; padding: 40px; }
        .container { max-width: 950px; margin: auto; background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        h1, h2 { text-align: center; color: #1e3a8a; }
        p { color: #1f2937; line-height: 1.6; }
        .insights { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
        .card { background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 2px 5px rgba(0,0,0,0.05); transition: 0.2s ease; }
        .card:hover { transform: translateY(-3px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .card h3 { color: #1e40af; margin-bottom: 10px; }
        #jobsTable { display: none; width: 100%; border-collapse: collapse; margin-top: 25px; }
        th, td { padding: 12px; border-bottom: 1px solid #ddd; text-align: left; }
        th { background: #2563eb; color: white; }
        tr:hover { background: #eef2ff; }
        a { color: #2563eb; text-decoration: none; }
        a:hover { text-decoration: underline; }
        button { display: block; margin: 20px auto; padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 5px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>AI Resume Analysis</h1>
        <h2>Insights</h2>

        <div class="insights">
          <div class="card">
            <h3>📋 Summary</h3>
            <p>${summary}</p>
          </div>

          <div class="card">
            <h3>💪 Key Strengths</h3>
            <p>${strengths}</p>
          </div>

          <div class="card">
            <h3>🧠 Technical Skills</h3>
            <p>${keywords.join(", ")}</p>
          </div>

          <div class="card">
            <h3>🎯 Suggested Roles</h3>
            <p>${suggestedRoles}</p>
          </div>
        </div>

        <button onclick="document.getElementById('jobsTable').style.display='table'">Show Job Matches</button>

        <table id="jobsTable">
          <tr>
            <th>Job Title</th>
            <th>Company</th>
            <th>Location</th>
            <th>Match %</th>
            <th>Apply</th>
          </tr>`;

    jobs.forEach((job) => {
      html += `
        <tr>
          <td>${job.title}</td>
          <td>${job.company}</td>
          <td>${job.location}</td>
          <td>${job.match}%</td>
          <td><a href="${job.url}" target="_blank">Apply</a></td>
        </tr>`;
    });

    html += `
        </table>
      </div>
    </body>
    </html>`;

    res.send(html);
  } catch (error) {
    console.error("❌ Error:", error);
    res.send(`<p>Error: ${error.message}</p>`);
  }
});

app.listen(process.env.PORT || 8000, () =>
  console.log(`✅ Server running on http://localhost:${process.env.PORT || 8000}`)
);
