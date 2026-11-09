import express from "express";
import puppeteer from "puppeteer";
import dns from "node:dns/promises";
import net from "node:net";

const app = express();
app.use(express.static("public"));

// Block private/internal addresses (basic SSRF protection)
function isPrivate(ip) {
  if (net.isIPv6(ip)) return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254);
}

let browser;
async function getBrowser() {
  if (!browser) browser = await puppeteer.launch({ args: ["--no-sandbox"] });
  return browser;
}

app.get("/pdf", async (req, res) => {
  let target;
  try {
    target = new URL(req.query.url);
    if (!["http:", "https:"].includes(target.protocol)) throw new Error();
  } catch {
    return res.status(400).send("Invalid URL. Use http:// or https://");
  }

  try {
    const { address } = await dns.lookup(target.hostname);
    if (isPrivate(address)) return res.status(400).send("That address is not allowed.");
  } catch {
    return res.status(400).send("Could not resolve that host.");
  }

  let page;
  try {
    page = await (await getBrowser()).newPage();
    await page.goto(target.href, { waitUntil: "networkidle2", timeout: 30000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
    const name = target.hostname.replace(/[^a-z0-9.-]/gi, "_") + ".pdf";
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"` });
    res.send(Buffer.from(pdf));
  } catch (e) {
    res.status(500).send("Failed to render the page: " + e.message);
  } finally {
    if (page) await page.close();
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Running on http://localhost:${port}`));
