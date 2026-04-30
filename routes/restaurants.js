const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function searchNearbyRestaurants(keywords, lat, lng) {
  const allResults = [];

  for (const keyword of keywords) {
    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
      {
        params: {
          location: `${lat},${lng}`,
          radius: 1500,
          keyword: `${keyword} 맛집`,
          type: 'restaurant',
          language: 'ko',
          key: process.env.GOOGLE_PLACES_API_KEY,
        },
      },
    );

    console.log(keyword, response.data.status, response.data.results?.length);
    allResults.push(...(response.data.results || []));
  }

  return Array.from(new Map(allResults.map((place) => [place.place_id, place])).values());
}

// 🔥 1. 질문 → 음식 키워드 추출
async function extractFoodKeyword(message) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `
너는 음식 추천 검색어 생성기야.

사용자 문장에서 음식 검색 키워드를 3개만 추출해.
반드시 공백으로 구분된 단어만 답해.
문장, 설명, 따옴표는 쓰지 마.

예시:
"나 오늘 면 땡겨" → 라멘 국수 우동
"고기 먹고 싶어" → 삼겹살 고깃집 소고기
"해장하고 싶어" → 국밥 해장국 설렁탕
"가볍게 먹고 싶어" → 샐러드 샌드위치 김밥
`,
      },
      {
        role: 'user',
        content: message,
      },
    ],
  });

  return response.choices[0].message.content.trim();
}

function getDistanceMeter(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 🔥 2. 맛집 추천 API
router.post('/recommend', async (req, res) => {
  try {
    const { message, lat, lng } = req.body;

    if (!message || !lat || !lng) {
      return res.status(400).json({
        message: '질문과 위치 정보가 필요합니다.',
      });
    }

    // 1️⃣ OpenAI → 키워드 추출
    const keywordText = await extractFoodKeyword(message);
    // 예: "라멘 국수 우동"

    const keywords = keywordText
      .split(/\s+/)
      .map((v) => v.trim())
      .filter(Boolean);

    // 2️⃣ Google Nearby Search 여러 번 실행
    const allResults = [];

    for (const keyword of keywords) {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
        {
          params: {
            location: `${lat},${lng}`,
            radius: 1500,
            keyword: `${keyword} 맛집`,
            type: 'restaurant',
            language: 'ko',
            key: process.env.GOOGLE_PLACES_API_KEY,
          },
        },
      );

      console.log(keyword, response.data.status, response.data.results?.length);

      allResults.push(...(response.data.results || []));
    }

    // 3️⃣ 중복 제거
    const uniquePlaces = Array.from(
      new Map(allResults.map((place) => [place.place_id, place])).values(),
    );

    // 4️⃣ 거리 계산 + 필터링 + 정렬
    const restaurants = uniquePlaces
      .map((place) => {
        const distance = getDistanceMeter(
          Number(lat),
          Number(lng),
          place.geometry.location.lat,
          place.geometry.location.lng,
        );

        return {
          name: place.name,
          rating: place.rating ?? 0,
          address: place.vicinity,
          placeId: place.place_id,
          distance: Math.round(distance),
          lat: place.geometry.location.lat,
          lng: place.geometry.location.lng,
          reason: `${keywordText} 관련 근처 맛집으로 추천해요.`,
        };
      })
      .filter((place) => place.distance <= 1500) // 1.5km 제한
      .sort((a, b) => {
        // 평점 우선 → 거리
        const ratingDiff = b.rating - a.rating;
        if (ratingDiff !== 0) return ratingDiff;
        return a.distance - b.distance;
      })
      .slice(0, 5);

    return res.json({
      keyword: keywordText,
      restaurants,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: '추천 중 오류 발생',
    });
  }
});

module.exports = router;
