const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log('OPENAI KEY exists:', !!process.env.OPENAI_API_KEY);
console.log('OPENAI KEY length:', process.env.OPENAI_API_KEY?.length);
console.log('OPENAI KEY prefix:', process.env.OPENAI_API_KEY?.slice(0, 7));

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
너는 맛집 추천을 위한 사용자 의도 분석기야.

사용자의 문장에서 감정, 상황, 음식 키워드를 분석해.
반드시 JSON만 반환해.

형식:
{
  "mood": "사용자 감정",
  "situation": "상황",
  "keywords": ["검색키워드1", "검색키워드2", "검색키워드3"],
  "recommendType": "추천 방향"
}

예시:
"나 오늘 우울한데 먹을만한 음식 추천해줘"
→ {
  "mood": "우울함",
  "situation": "기분 전환이 필요함",
  "keywords": ["국밥", "라멘", "칼국수"],
  "recommendType": "따뜻하고 든든한 음식"
}

"나 오늘 면 땡겨"
→ {
  "mood": "평범함",
  "situation": "면 요리가 먹고 싶음",
  "keywords": ["라멘", "국수", "우동"],
  "recommendType": "면 요리"
}
`,
      },
      {
        role: 'user',
        content: message,
      },
    ],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content);
}

async function generateRecommendationReasons({ userMessage, intent, restaurants }) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `
너는 다정한 맛집 추천 도우미야.

사용자의 감정과 상황을 고려해서 식당별 추천 이유를 자연스럽게 작성해.
너무 과장하지 말고, 짧고 따뜻하게 말해.
반드시 JSON 배열만 반환해.

형식:
[
  {
    "placeId": "식당 placeId",
    "reason": "추천 이유"
  }
]
`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          userMessage,
          intent,
          restaurants,
        }),
      },
    ],
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(response.choices[0].message.content);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.reasons)) {
    return parsed.reasons;
  }

  return [];
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

function getPlaceType(keyword) {
  const dessertKeywords = ['디저트', '카페', '케이크', '빙수', '마카롱', '빵', '아이스크림'];

  if (dessertKeywords.some((word) => keyword.includes(word))) {
    return 'cafe';
  }

  return 'restaurant';
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

    const intent = await extractFoodKeyword(message);

    const keywords = intent.keywords ?? ['맛집'];
    const allResults = [];

    for (const keyword of keywords) {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
        {
          params: {
            location: `${lat},${lng}`,
            radius: 1500,
            keyword: `${keyword} 맛집`,
            type: getPlaceType(keyword),
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
    let restaurants = uniquePlaces
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
          reason: ``,
        };
      })
      .filter((place) => place.distance <= 700) // 1.5km 제한
      .sort((a, b) => {
        // 평점 우선 → 거리
        const ratingDiff = b.rating - a.rating;
        if (ratingDiff !== 0) return ratingDiff;
        return a.distance - b.distance;
      })
      .slice(0, 5);

    const reasons = await generateRecommendationReasons({
      userMessage: message,
      intent,
      restaurants,
    });

    restaurants = restaurants.map((restaurant) => {
      const matchedReason = Array.isArray(reasons)
        ? reasons.find((item) => item.placeId === restaurant.placeId)
        : null;

      return {
        ...restaurant,
        reason: matchedReason?.reason ?? `${intent.recommendType}을 찾는 분께 추천해요.`,
      };
    });

    return res.json({
      intent,
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
