import axios from "axios";
import * as cheerio from 'cheerio';
import { Redis } from "@upstash/redis";
import { getRandomUA } from "../../../src/utils/userAgen.js";
import { createApiKeyMiddleware } from "../../middleware/apikey.js";

const redis = (() => {
  try {
    return Redis.fromEnv();
  } catch {
    console.warn("[WARN] Upstash Redis not configured");
    return null;
  }
})();

const cache = {
  async get(key) {
    if (!redis) return null;
    try { return await redis.get(key); } catch { return null; }
  },
  async set(key, data, ttl) {
    if (!redis) return false;
    try { await redis.set(key, data, { ex: ttl }); return true; } catch { return false; }
  }
};

const apiKeyHook = async (request, reply) => {
  return new Promise((resolve, reject) => {
    createApiKeyMiddleware()(request.raw, reply.raw, (err) => {
      if (err) {
        reply.send(err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const ttSearch = async (query, noCache = false) => {
  const cacheKey = `tiktok_search:${query.toLowerCase()}`;
  
  if (!noCache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] TikTok Search: ${query}`);
      return cached;
    }
  }
  
  console.log(`[CACHE MISS] TikTok Search: ${query} - Fetching...`);
  
  const d = new URLSearchParams();
  d.append("keywords", query);
  d.append("count", "15");
  d.append("cursor", "0");
  d.append("web", "1");
  d.append("hd", "1");

  const { data } = await axios.post("https://tikwm.com/api/feed/search", d, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const baseURL = "https://tikwm.com";
  const videos = data.data.videos.map(video => ({
    ...video,
    play: baseURL + video.play,
    wmplay: baseURL + video.wmplay,
    music: baseURL + video.music,
    cover: baseURL + video.cover,
    avatar: baseURL + video.avatar
  }));
  
  await cache.set(cacheKey, videos, 3600);
  
  return videos;
};

const headers = {
  "authority": "ttsave.app",
  "accept": "application/json, text/plain, */*",
  "origin": "https://ttsave.app",
  "referer": "https://ttsave.app/en",
  "user-agent": "Postify/1.0.0",
};

const tiktokdl = {
  submit: async function(url, referer) {
    const headerx = { ...headers, referer };
    const data = { "query": url, "language_id": "1" };
    return axios.post('https://ttsave.app/download', data, { headers: headerx });
  },

  parse: function($) {
    const description = $('p.text-gray-600').text().trim();
    const dlink = {
      nowm: $('a.w-full.text-white.font-bold').first().attr('href'),
      audio: $('a[type="audio"]').attr('href'),
    };

    const slides = $('a[type="slide"]').map((i, el) => ({
      number: i + 1,
      url: $(el).attr('href')
    })).get();

    return { description, dlink, slides };
  },

  fetchData: async function(link, noCache = false) {
    const cacheKey = `tiktok_dl_v1:${Buffer.from(link).toString('base64')}`;
    
    if (!noCache) {
      const cached = await cache.get(cacheKey);
      if (cached) {
        console.log(`[CACHE HIT] TikTok Download V1: ${link}`);
        return cached;
      }
    }
    
    console.log(`[CACHE MISS] TikTok Download V1: ${link} - Fetching...`);
    
    try {
      const response = await this.submit(link, 'https://ttsave.app/en');
      const $ = cheerio.load(response.data);
      const result = this.parse($);
      const output = {
        video_nowm: result.dlink.nowm,
        audio_url: result.dlink.audio,
        slides: result.slides,
        description: result.description
      };
      
      await cache.set(cacheKey, output, 7200);
      
      return output;
    } catch (error) {
      throw error;
    }
  }
};

const tiktok = async (query, noCache = false) => {
  const cacheKey = `tiktok_dl_v2:${Buffer.from(query).toString('base64')}`;
  
  if (!noCache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] TikTok Download V2: ${query}`);
      return cached;
    }
  }
  
  console.log(`[CACHE MISS] TikTok Download V2: ${query} - Fetching...`);
  
  const encodedParams = new URLSearchParams();
  encodedParams.set("url", query);
  encodedParams.set("hd", "1");

  const response = await axios({
    method: "POST",
    url: "https://tikwm.com/api/",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Cookie": "current_language=en",
      "User-Agent": getRandomUA()
    },
    data: encodedParams,
  });
  
  const result = response.data;
  
  await cache.set(cacheKey, result, 7200);
  
  return result;
};

export default (app) => {
  app.get("/api/search/tiktok", { preHandler: apiKeyHook }, async (request, reply) => {
    const { q, nocache } = request.query;
    if (!q) {
      return reply.code(400).send({ status: false, error: 'Query is required' });
    }
    try {
      const results = await ttSearch(q, nocache === 'true');
      return reply.code(200).send({ 
        status: true, 
        result: results,
        _cached: results._cached || false,
        _cacheTTL: "1 jam"
      });
    } catch (error) {
      return reply.code(500).send({ status: false, error: error.message });
    }
  });

  app.get("/api/download/tiktok", { preHandler: apiKeyHook }, async (request, reply) => {
    const { url, nocache } = request.query;
    if (!url) {
      return reply.code(400).send({ status: false, error: 'Url is required' });
    }
    try {
      const results = await tiktokdl.fetchData(url, nocache === 'true');
      return reply.code(200).send({ 
        status: true, 
        result: results,
        _cached: results._cached || false,
        _cacheTTL: "2 jam"
      });
    } catch (error) {
      return reply.code(500).send({ status: false, error: error.message });
    }
  });

  app.get("/api/downloader/tiktok", { preHandler: apiKeyHook }, async (request, reply) => {
    const { url, nocache } = request.query;
    if (!url) {
      return reply.code(400).send({ status: false, error: 'Url is required' });
    }
    try {
      const results = await tiktok(url, nocache === 'true');
      return reply.code(200).send({ 
        status: true, 
        result: results,
        _cached: results._cached || false,
        _cacheTTL: "2 jam"
      });
    } catch (error) {
      return reply.code(500).send({ status: false, error: error.message });
    }
  });
  
  app.get("/api/downloader/tiktok/info", { preHandler: apiKeyHook }, async (request, reply) => {
    try {
      const info = {
        nama_endpoint: "TikTok Downloader",
        deskripsi: "Download video TikTok tanpa watermark dan search konten",
        base_url: "https://api.asuma.my.id",
        cara_pakai: [
          {
            metode: "GET",
            endpoint: "/api/search/tiktok",
            parameter: "?q=KEYWORD&nocache=true",
            contoh: "https://api.asuma.my.id/api/search/tiktok?q=cat&apikey=API_KEY_KAMU",
            keterangan: "Mencari video TikTok berdasarkan keyword"
          },
          {
            metode: "GET",
            endpoint: "/api/download/tiktok",
            parameter: "?url=URL_TIKTOK&nocache=true",
            contoh: "https://api.asuma.my.id/api/download/tiktok?url=https://www.tiktok.com/@username/video/xxx&apikey=API_KEY_KAMU",
            keterangan: "Download video TikTok (via ttsave.app)"
          },
          {
            metode: "GET",
            endpoint: "/api/downloader/tiktok",
            parameter: "?url=URL_TIKTOK&nocache=true",
            contoh: "https://api.asuma.my.id/api/downloader/tiktok?url=https://www.tiktok.com/@username/video/xxx&apikey=API_KEY_KAMU",
            keterangan: "Download video TikTok (via tikwm.com)"
          }
        ],
        fitur: [
          "Search video TikTok berdasarkan keyword",
          "Download video tanpa watermark",
          "Download audio MP3",
          "Support slide/photo posts",
          "Cache 1 jam untuk search, 2 jam untuk download"
        ],
        cache_info: {
          enabled: redis !== null,
          ttl: {
            search: "1 jam (3600 detik)",
            download: "2 jam (7200 detik)"
          }
        },
        limit: "100 request/jam",
        terakhir_update: "2026-06-28",
      };
      
      return reply.code(200).send({
        status: true,
        data: info,
      });
    } catch (error) {
      console.error("[ERROR] /api/downloader/tiktok/info:", error.message);
      return reply.code(500).send({
        status: false,
        error: "Gagal mengambil informasi endpoint",
      });
    }
  });
};
