import axios from "axios";

async function unsplashRequest(getFn, retries = 3, baseDelay = 500) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await getFn();
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const code = err?.code;
      const retryable =
        [429, 500, 502, 503, 504].includes(status) ||
        ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ECONNABORTED"].includes(code);
      if (!retryable || attempt === retries) break;
      const delay = baseDelay * 2 ** attempt + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

async function unsplashGetRandomPhoto({ accessKey, appName, query, orientation, contentFilter }) {
  const headers = {
    Authorization: `Client-ID ${accessKey}`,
    "Accept-Version": "v1",
    "User-Agent": `tg-bot/${appName}`,
  };

  const res = await unsplashRequest(() =>
    axios.get("https://api.unsplash.com/photos/random", {
      headers,
      params: { query, orientation, content_filter: contentFilter },
      timeout: 30000,
    })
  );

  return res.data;
}

async function unsplashTrackDownload({ accessKey, appName, downloadLocation }) {
  const headers = {
    Authorization: `Client-ID ${accessKey}`,
    "Accept-Version": "v1",
    "User-Agent": `tg-bot/${appName}`,
  };

  const res = await unsplashRequest(() =>
    axios.get(downloadLocation, {
      headers,
      timeout: 30000,
    })
  );

  return res.data?.url;
}

function withUnsplashParams(url, { w, q }) {
  const u = new URL(url);
  u.searchParams.set("w", String(w));
  u.searchParams.set("q", String(q));
  u.searchParams.set("fm", "jpg");
  u.searchParams.set("fit", "max");
  return u.toString();
}

async function fetchImageBufferSmart({ url, maxBytes, widths }) {
  for (const cfg of widths) {
    const finalUrl = withUnsplashParams(url, cfg);
    try {
      const head = await axios.head(finalUrl, { timeout: 15000, maxRedirects: 5 });
      const len = Number(head.headers["content-length"] || 0);
      const ct = String(head.headers["content-type"] || "image/jpeg");
      if (len && len > maxBytes) continue;

      const res = await axios.get(finalUrl, { responseType: "arraybuffer", timeout: 30000, maxRedirects: 5 });
      const buf = Buffer.from(res.data);
      if (buf.length > maxBytes) continue;

      return { buffer: buf, contentType: ct, finalUrl };
    } catch {
      // try next
    }
  }

  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000, maxRedirects: 5 });
  const buf = Buffer.from(res.data);
  if (buf.length > maxBytes) {
    throw new Error(`Unsplash image too large: ${buf.length} bytes (limit ${maxBytes})`);
  }
  return { buffer: buf, contentType: String(res.headers["content-type"] || "image/jpeg"), finalUrl: url };
}

export async function pickUnsplashImage({
  accessKey,
  appName,
  rubric,
  theme,
  usedStore,
  orientation,
  contentFilter,
  maxBytes,
  imgWidth,
  imgQuality,
  defaultQuery,
}) {
  const used = usedStore.read();
  const queryByRubric = theme?.unsplash?.queryByRubric || {};
  const query = queryByRubric[rubric] || queryByRubric.default || defaultQuery || "minimal calm";

  for (let i = 0; i < 5; i += 1) {
    const photo = await unsplashGetRandomPhoto({
      accessKey,
      appName,
      query,
      orientation,
      contentFilter,
    });

    if (!photo?.id || !photo?.links?.download_location) continue;
    if (used.ids.includes(photo.id)) continue;

    const fileUrl = await unsplashTrackDownload({
      accessKey,
      appName,
      downloadLocation: photo.links.download_location,
    });
    if (!fileUrl) continue;

    const widths = [
      { w: imgWidth, q: imgQuality },
      { w: Math.round(imgWidth * 0.8), q: Math.max(60, imgQuality - 10) },
      { w: Math.round(imgWidth * 0.65), q: Math.max(55, imgQuality - 15) },
    ];

    const { buffer, contentType } = await fetchImageBufferSmart({ url: fileUrl, maxBytes, widths });

    used.ids.push(photo.id);
    if (used.ids.length > 300) used.ids = used.ids.slice(-250);
    usedStore.write(used);

    return {
      type: "buffer",
      buffer,
      filename: `unsplash_${photo.id}.jpg`,
      contentType: contentType || "image/jpeg",
    };
  }

  throw new Error("Unsplash image not found (duplicates or API error)");
}
