// Giftree - Cloudflare Worker Backend

// 쿠키 파싱
function parseCookies(cookieHeader) {
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    });
  }
  return cookies;
}

// 쿠키 설정 헤더 생성
function setCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

// 세션 ID 생성
function generateSessionId() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// 나무 ID 생성
function generateTreeId() {
  return 'tree_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// JSON 응답
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

// 에러 응답
function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// 현재 사용자 가져오기
async function getCurrentUser(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionId = cookies.session;
  
  if (!sessionId) return null;
  
  const session = await env.SESSIONS.get(sessionId, { type: 'json' });
  if (!session) return null;
  
  const user = await env.USERS.get('user:' + session.userId, { type: 'json' });
  return user;
}

// HTML 파일 서빙 (SPA 라우팅 지원)
async function serveStaticFile(request, env, path) {
  // Cloudflare Workers Sites를 사용하지 않는 경우를 위한 대체 구현
  // 실제로는 wrangler.toml의 [site] 설정으로 정적 파일 서빙
  
  // SPA 라우팅: /land/* 경로도 index.html로
  if (path.startsWith('/land/') || path === '/land') {
    path = '/index.html';
  }
  
  // 기본 경로
  if (path === '/' || path === '') {
    path = '/index.html';
  }
  
  // 정적 파일 요청은 __STATIC_CONTENT에서 가져옴
  try {
    // Workers Sites 사용 시
    if (env.__STATIC_CONTENT) {
      const asset = await env.__STATIC_CONTENT.get(path.slice(1));
      if (asset) {
        const contentType = getContentType(path);
        return new Response(asset, {
          headers: { 'Content-Type': contentType }
        });
      }
    }
  } catch (e) {
    // 에러 무시
  }
  
  return null;
}

// Content-Type 결정
function getContentType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.ico')) return 'image/x-icon';
  return 'text/plain';
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS 헤더
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    
    // OPTIONS 요청 처리
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // API 라우팅
    if (path.startsWith('/api/')) {
      const apiPath = path.slice(4); // '/api' 제거
      
      try {
        // Google OAuth 시작
        if (apiPath === '/auth/google' && request.method === 'GET') {
          const redirectUri = url.origin + '/api/auth/callback';
          const state = generateSessionId();
          
          // state 저장 (CSRF 방지)
          await env.SESSIONS.put('oauth_state:' + state, 'pending', { expirationTtl: 600 });
          
          const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid email profile',
            state: state,
            access_type: 'offline',
            prompt: 'consent'
          });
          
          return Response.redirect(authUrl, 302);
        }
        
        // Google OAuth 콜백
        if (apiPath === '/auth/callback' && request.method === 'GET') {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');
          
          if (error) {
            return Response.redirect(url.origin + '/?error=auth_denied', 302);
          }
          
          if (!code || !state) {
            return Response.redirect(url.origin + '/?error=invalid_request', 302);
          }
          
          // state 확인
          const storedState = await env.SESSIONS.get('oauth_state:' + state);
          if (!storedState) {
            return Response.redirect(url.origin + '/?error=invalid_state', 302);
          }
          await env.SESSIONS.delete('oauth_state:' + state);
          
          // 토큰 교환
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: env.GOOGLE_CLIENT_ID,
              client_secret: env.GOOGLE_CLIENT_SECRET,
              redirect_uri: url.origin + '/api/auth/callback',
              code: code,
              grant_type: 'authorization_code'
            })
          });
          
          const tokens = await tokenResponse.json();
          
          if (tokens.error) {
            console.error('Token error:', tokens);
            return Response.redirect(url.origin + '/?error=token_error', 302);
          }
          
          // 사용자 정보 가져오기
          const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
          });
          
          const googleUser = await userInfoResponse.json();
          
          // 사용자 저장/업데이트
          const userId = googleUser.id;
          let user = await env.USERS.get('user:' + userId, { type: 'json' });
          
          if (!user) {
            // 새 사용자
            user = {
              id: userId,
              email: googleUser.email,
              name: googleUser.name,
              nickname: googleUser.name,
              profileImage: googleUser.picture,
              settings: {
                skyColor: '#87CEEB',
                landColor: '#8B4513'
              },
              createdAt: new Date().toISOString()
            };
            
            // 토지 생성
            await env.LANDS.put('land:' + userId, JSON.stringify({
              ownerId: userId,
              trees: [],
              createdAt: new Date().toISOString()
            }));
          } else {
            // 기존 사용자 - 구글 정보 업데이트 (프로필 이미지가 기본값이면)
            if (user.profileImage === googleUser.picture || !user.profileImage) {
              user.profileImage = googleUser.picture;
            }
          }
          
          await env.USERS.put('user:' + userId, JSON.stringify(user));
          
          // 세션 생성
          const sessionId = generateSessionId();
          await env.SESSIONS.put(sessionId, JSON.stringify({
            userId: userId,
            createdAt: new Date().toISOString()
          }), { expirationTtl: 60 * 60 * 24 * 30 }); // 30일
          
          // 쿠키 설정하고 토지로 리다이렉트
          const cookie = setCookie('session', sessionId, {
            maxAge: 60 * 60 * 24 * 30,
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
          });
          
          return new Response(null, {
            status: 302,
            headers: {
              'Location': url.origin + '/land/' + userId,
              'Set-Cookie': cookie
            }
          });
        }
        
        // 현재 사용자 정보
        if (apiPath === '/auth/me' && request.method === 'GET') {
          const user = await getCurrentUser(request, env);
          if (!user) {
            return jsonResponse({ user: null });
          }
          return jsonResponse({ user });
        }
        
        // 로그아웃
        if (apiPath === '/auth/logout' && request.method === 'POST') {
          const cookies = parseCookies(request.headers.get('Cookie'));
          const sessionId = cookies.session;
          
          if (sessionId) {
            await env.SESSIONS.delete(sessionId);
          }
          
          const cookie = setCookie('session', '', {
            maxAge: 0,
            path: '/'
          });
          
          return jsonResponse({ success: true }, 200, { 'Set-Cookie': cookie });
        }
        
        // 토지 정보 가져오기
        if (apiPath.match(/^\/land\/[a-zA-Z0-9_-]+$/) && request.method === 'GET') {
          const landId = apiPath.split('/')[2];
          
          // 토지 소유자 정보
          const owner = await env.USERS.get('user:' + landId, { type: 'json' });
          if (!owner) {
            return errorResponse('Land not found', 404);
          }
          
          // 토지 데이터
          let land = await env.LANDS.get('land:' + landId, { type: 'json' });
          if (!land) {
            // 토지가 없으면 생성
            land = {
              ownerId: landId,
              trees: [],
              createdAt: new Date().toISOString()
            };
            await env.LANDS.put('land:' + landId, JSON.stringify(land));
          }
          
          // 현재 사용자 확인 (토지 주인인지)
          const currentUser = await getCurrentUser(request, env);
          const isOwner = currentUser && currentUser.id === landId;
          
          // 나무 정보에서 메시지/이미지는 소유자만 볼 수 있음
          const trees = land.trees.map(tree => {
            if (isOwner) {
              return tree;
            } else {
              return {
                id: tree.id,
                type: tree.type,
                planterName: tree.planterName,
                plantedAt: tree.plantedAt
                // message와 imageUrl은 제외
              };
            }
          });
          
          return jsonResponse({
            owner: {
              id: owner.id,
              nickname: owner.nickname || owner.name,
              profileImage: owner.profileImage,
              settings: owner.settings
            },
            trees: trees,
            isOwner: isOwner
          });
        }
        
        // 나무 심기
        if (apiPath.match(/^\/land\/[a-zA-Z0-9_-]+\/plant$/) && request.method === 'POST') {
          const landId = apiPath.split('/')[2];
          
          // 로그인 확인
          const currentUser = await getCurrentUser(request, env);
          if (!currentUser) {
            return errorResponse('Login required', 401);
          }
          
          // 자신의 토지에는 심을 수 없음
          if (currentUser.id === landId) {
            return errorResponse('Cannot plant on your own land', 400);
          }
          
          // 토지 확인
          let land = await env.LANDS.get('land:' + landId, { type: 'json' });
          if (!land) {
            return errorResponse('Land not found', 404);
          }
          
          // 요청 데이터
          const body = await request.json();
          const { message, imageData, treeType } = body;
          
          if (!message && !imageData) {
            return errorResponse('Message or image required', 400);
          }
          
          // 나무 타입 검증
          const validTreeTypes = ['cherry', 'pine', 'maple', 'christmas'];
          if (treeType && !validTreeTypes.includes(treeType)) {
            return errorResponse('Invalid tree type', 400);
          }
          
          // 이미지 데이터 검증 (Base64는 ~33% 더 크므로 ~667KB 문자열 = ~500KB 바이너리)
          if (imageData && imageData.length > 667 * 1024) {
            return errorResponse('Image too large (max 500KB)', 400);
          }
          
          // 나무 생성
          const tree = {
            id: generateTreeId(),
            type: treeType || 'pine',
            planterId: currentUser.id,
            planterName: currentUser.nickname || currentUser.name,
            message: message || '',
            imageUrl: imageData || null,
            plantedAt: new Date().toISOString()
          };
          
          // 토지에 나무 추가
          land.trees.push(tree);
          await env.LANDS.put('land:' + landId, JSON.stringify(land));
          
          return jsonResponse({ success: true, tree: { id: tree.id } });
        }
        
        // 사용자 설정 저장
        if (apiPath === '/user/settings' && request.method === 'POST') {
          const currentUser = await getCurrentUser(request, env);
          if (!currentUser) {
            return errorResponse('Login required', 401);
          }
          
          const body = await request.json();
          const { nickname, profileImage, settings } = body;
          
          // 닉네임 검증
          if (nickname !== undefined) {
            if (typeof nickname !== 'string' || nickname.length > 20) {
              return errorResponse('Invalid nickname', 400);
            }
            currentUser.nickname = nickname;
          }
          
          // 프로필 이미지 검증 (최대 200KB)
          if (profileImage !== undefined) {
            if (profileImage && profileImage.length > 200 * 1024) {
              return errorResponse('Profile image too large (max 200KB)', 400);
            }
            currentUser.profileImage = profileImage;
          }
          
          // 설정 업데이트
          if (settings) {
            currentUser.settings = {
              ...currentUser.settings,
              ...settings
            };
          }
          
          await env.USERS.put('user:' + currentUser.id, JSON.stringify(currentUser));
          
          return jsonResponse({ success: true, user: currentUser });
        }
        
        // API 경로를 찾을 수 없음
        return errorResponse('Not found', 404);
        
      } catch (error) {
        console.error('API Error:', error);
        return errorResponse('Internal server error: ' + error.message, 500);
      }
    }
    
    // 정적 파일 서빙 시도
    const staticResponse = await serveStaticFile(request, env, path);
    if (staticResponse) {
      return staticResponse;
    }
    
    // SPA 라우팅: 모든 경로에서 index.html 반환
    // Workers Sites가 설정되어 있으면 자동으로 처리됨
    // 여기서는 index.html을 직접 서빙 시도
    if (!path.includes('.')) {
      // Workers Sites에서 index.html 가져오기 시도
      try {
        if (env.__STATIC_CONTENT) {
          const indexHtml = await env.__STATIC_CONTENT.get('index.html');
          if (indexHtml) {
            return new Response(indexHtml, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
          }
        }
      } catch (e) {
        // 에러 무시
      }
      
      // fallback: 리다이렉트 없이 에러 메시지 표시
      return new Response(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Giftree</title>
</head>
<body>
  <h1>페이지를 불러올 수 없습니다</h1>
  <p>Workers Sites 설정을 확인해주세요.</p>
  <p><a href="/">홈으로 돌아가기</a></p>
</body>
</html>
      `, {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
};
