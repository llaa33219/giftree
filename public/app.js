// Giftree - Frontend Application

(function() {
  'use strict';

  // 상태 관리
  const state = {
    currentUser: null,
    landOwner: null,
    trees: [],
    isOwnLand: false,
    viewingLandId: null
  };

  // 계절별 나무 종류
  const TREE_TYPES = {
    spring: { type: 'cherry', name: '벚나무', emoji: '🌸' },
    summer: { type: 'pine', name: '소나무', emoji: '🌲' },
    autumn: { type: 'maple', name: '단풍나무', emoji: '🍁' },
    winter: { type: 'christmas', name: '크리스마스 트리', emoji: '🎄' }
  };

  // 현재 계절 가져오기
  function getCurrentSeason() {
    const month = new Date().getMonth() + 1;
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
  }

  // 나무 HTML 파일 URL (SVG 스크립트 포함)
  function getTreeHtmlUrl(treeType) {
    const htmlFiles = {
      cherry: '/images/cherry.html',
      pine: '/images/pine.html',
      maple: '/images/maple.html',
      christmas: '/images/christmas.html'
    };
    return htmlFiles[treeType] || htmlFiles.pine;
  }

  // 나무 이모지 fallback
  function getTreeEmoji(treeType) {
    const emojis = {
      cherry: '🌸',
      pine: '🌲',
      maple: '🍁',
      christmas: '🎄'
    };
    return emojis[treeType] || '🌳';
  }

  // 나무 이모지 fallback 표시
  function showTreeEmojiFallback(element, treeType) {
    element.style.display = 'none';
    const emoji = document.createElement('div');
    emoji.className = 'tree-emoji';
    emoji.style.fontSize = '80px';
    emoji.style.width = '120px';
    emoji.style.height = '150px';
    emoji.style.display = 'flex';
    emoji.style.alignItems = 'center';
    emoji.style.justifyContent = 'center';
    emoji.textContent = getTreeEmoji(treeType);
    element.parentNode.insertBefore(emoji, element);
  }

  // API 호출 헬퍼
  async function api(endpoint, options = {}) {
    const response = await fetch('/api' + endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || 'API Error');
    }
    return response.json();
  }

  // 토스트 메시지 표시
  function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, duration);
  }

  // 날짜 포맷
  function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  // URL에서 토지 ID 추출
  function getLandIdFromUrl() {
    const path = window.location.pathname;
    const match = path.match(/^\/land\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  // 나무 렌더링
  function renderTrees() {
    const container = document.getElementById('trees-container');
    container.innerHTML = '';

    if (state.trees.length === 0) {
      // 기본 나무 하나 표시 (계절에 맞는)
      const season = getCurrentSeason();
      const defaultTree = TREE_TYPES[season];
      const treeEl = createTreeElement({
        id: 'default',
        type: defaultTree.type,
        planterName: '',
        plantedAt: new Date().toISOString(),
        message: '첫 번째 나무를 기다리고 있어요!',
        isDefault: true
      });
      container.appendChild(treeEl);
    } else {
      // 나무들 표시 (오래된 순서대로, 최신이 오른쪽)
      state.trees.forEach(tree => {
        const treeEl = createTreeElement(tree);
        container.appendChild(treeEl);
      });
    }

    // 최신 나무(오른쪽)로 스크롤
    const landContainer = document.getElementById('land-container');
    landContainer.scrollLeft = landContainer.scrollWidth;

    // 토지 너비 조정
    const land = document.getElementById('land');
    const minWidth = Math.max(window.innerWidth, state.trees.length * 180 + 100);
    land.style.width = minWidth + 'px';
  }

  // 나무 요소 생성
  function createTreeElement(tree) {
    const div = document.createElement('div');
    div.className = 'tree';
    div.dataset.treeId = tree.id;

    // iframe으로 HTML 파일 로드 (SVG 스크립트 포함)
    const iframe = document.createElement('iframe');
    iframe.className = 'tree-image';
    iframe.src = getTreeHtmlUrl(tree.type);
    iframe.title = tree.type;
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.style.backgroundColor = 'transparent';
    iframe.onerror = function() {
      // 로드 실패 시 이모지로 대체
      showTreeEmojiFallback(this, tree.type);
    };
    // iframe 로드 실패 감지를 위한 추가 처리
    iframe.onload = function() {
      try {
        // iframe 내용이 비어있으면 fallback
        if (!this.contentDocument || !this.contentDocument.body.innerHTML) {
          showTreeEmojiFallback(this, tree.type);
        }
      } catch (e) {
        // cross-origin 에러는 무시 (정상적으로 로드된 경우)
      }
    };

    const sign = document.createElement('div');
    sign.className = 'tree-sign';

    div.appendChild(iframe);

    if (tree.isDefault) {
      sign.innerHTML = '<div class="sign-owner">🌱</div><div class="sign-date">첫 나무를 기다려요</div>';
    } else {
      sign.innerHTML = `
        <div class="sign-owner">${escapeHtml(tree.planterName)}님이</div>
        <div class="sign-date">${formatDate(tree.plantedAt)}에 심은 나무</div>
      `;
    }

    div.appendChild(sign);

    // 클릭 이벤트 (토지 주인만 메시지 확인 가능)
    if (!tree.isDefault && state.isOwnLand) {
      div.addEventListener('click', () => showSignModal(tree));
      div.style.cursor = 'pointer';
    } else if (!tree.isDefault) {
      div.addEventListener('click', () => {
        showToast(`${tree.planterName}님이 ${formatDate(tree.plantedAt)}에 심은 나무입니다.`);
      });
    }

    return div;
  }

  // HTML 이스케이프
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 팻말 모달 표시
  function showSignModal(tree) {
    const modal = document.getElementById('sign-modal');
    const info = document.getElementById('sign-info');
    const content = document.getElementById('sign-content');
    const imageView = document.getElementById('sign-image-view');

    info.textContent = `${tree.planterName}님이 ${formatDate(tree.plantedAt)}에 심은 나무입니다.`;
    content.textContent = tree.message || '(메시지 없음)';

    if (tree.imageUrl) {
      imageView.innerHTML = `<img src="${tree.imageUrl}" alt="첨부 이미지">`;
    } else {
      imageView.innerHTML = '';
    }

    modal.classList.remove('hidden');
  }

  // 토지 테마 적용
  function applyLandTheme(settings) {
    if (settings) {
      if (settings.skyColor) {
        document.getElementById('sky').style.background = 
          `linear-gradient(to bottom, ${settings.skyColor}, ${lightenColor(settings.skyColor, 30)})`;
      }
      if (settings.landColor) {
        document.getElementById('land').style.background = 
          `linear-gradient(to bottom, ${settings.landColor} 0%, ${darkenColor(settings.landColor, 20)} 50%, ${darkenColor(settings.landColor, 40)} 100%)`;
      }
    }
  }

  // 색상 밝게
  function lightenColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (
      0x1000000 +
      (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
      (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
      (B < 255 ? (B < 1 ? 0 : B) : 255)
    ).toString(16).slice(1);
  }

  // 색상 어둡게
  function darkenColor(color, percent) {
    return lightenColor(color, -percent);
  }

  // UI 업데이트
  function updateUI() {
    const loginScreen = document.getElementById('login-screen');
    const shareBanner = document.getElementById('share-banner');
    const userMenu = document.getElementById('user-menu');
    const plantScreen = document.getElementById('plant-tree-screen');

    const landId = getLandIdFromUrl();

    if (!landId && !state.currentUser) {
      // 메인 페이지, 비로그인
      loginScreen.classList.remove('hidden');
      shareBanner.classList.add('hidden');
      userMenu.classList.add('hidden');
      plantScreen.classList.add('hidden');
    } else if (!landId && state.currentUser) {
      // 메인 페이지, 로그인됨 -> 자신의 토지로 리다이렉트
      window.location.href = '/land/' + state.currentUser.id;
    } else if (landId && state.isOwnLand) {
      // 자신의 토지
      loginScreen.classList.add('hidden');
      shareBanner.classList.remove('hidden');
      userMenu.classList.remove('hidden');
      plantScreen.classList.add('hidden');

      document.getElementById('user-avatar').src = state.currentUser.profileImage || '';
      document.getElementById('user-name').textContent = state.currentUser.nickname || state.currentUser.name;
    } else if (landId && !state.isOwnLand) {
      // 다른 사람의 토지
      loginScreen.classList.add('hidden');
      shareBanner.classList.add('hidden');
      plantScreen.classList.remove('hidden');

      if (state.currentUser) {
        userMenu.classList.remove('hidden');
        document.getElementById('user-avatar').src = state.currentUser.profileImage || '';
        document.getElementById('user-name').textContent = state.currentUser.nickname || state.currentUser.name;
      } else {
        userMenu.classList.add('hidden');
      }
    }
  }

  // 토지 데이터 로드
  async function loadLand(landId) {
    try {
      const data = await api('/land/' + landId);
      state.landOwner = data.owner;
      state.trees = data.trees || [];
      state.viewingLandId = landId;
      state.isOwnLand = state.currentUser && state.currentUser.id === landId;

      applyLandTheme(data.owner.settings);
      renderTrees();
      updateUI();
    } catch (error) {
      console.error('Failed to load land:', error);
      showToast('토지를 불러오는데 실패했습니다.');
    }
  }

  // 현재 사용자 정보 로드
  async function loadCurrentUser() {
    try {
      const data = await api('/auth/me');
      if (data.user) {
        state.currentUser = data.user;
      }
    } catch (error) {
      // 로그인 안됨
      state.currentUser = null;
    }
  }

  // 이미지를 Base64로 변환
  function imageToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 나무 심기
  async function plantTree(message, imageFile) {
    try {
      let imageData = null;
      if (imageFile) {
        imageData = await imageToBase64(imageFile);
      }

      const season = getCurrentSeason();
      const treeType = TREE_TYPES[season].type;

      await api('/land/' + state.viewingLandId + '/plant', {
        method: 'POST',
        body: JSON.stringify({
          message: message,
          imageData: imageData,
          treeType: treeType
        })
      });

      showToast('나무를 심었습니다! 🌱');
      await loadLand(state.viewingLandId);
    } catch (error) {
      console.error('Failed to plant tree:', error);
      showToast('나무 심기에 실패했습니다: ' + error.message);
    }
  }

  // 설정 저장
  async function saveSettings(settings) {
    try {
      await api('/user/settings', {
        method: 'POST',
        body: JSON.stringify(settings)
      });

      state.currentUser = { ...state.currentUser, ...settings };
      showToast('설정이 저장되었습니다!');
      applyLandTheme(settings);
      updateUI();
    } catch (error) {
      console.error('Failed to save settings:', error);
      showToast('설정 저장에 실패했습니다.');
    }
  }

  // 이벤트 리스너 설정
  function setupEventListeners() {
    // 구글 로그인
    document.getElementById('google-login-btn').addEventListener('click', () => {
      window.location.href = '/api/auth/google';
    });

    // 링크 복사
    document.getElementById('copy-link-btn').addEventListener('click', async () => {
      const url = window.location.origin + '/land/' + state.currentUser.id;
      try {
        await navigator.clipboard.writeText(url);
        showToast('링크가 복사되었습니다!');
      } catch (error) {
        // Fallback
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('링크가 복사되었습니다!');
      }
    });

    // 로그아웃
    document.getElementById('logout-btn').addEventListener('click', async () => {
      try {
        await api('/auth/logout', { method: 'POST' });
        state.currentUser = null;
        window.location.href = '/';
      } catch (error) {
        console.error('Logout failed:', error);
      }
    });

    // 설정 버튼
    document.getElementById('settings-btn').addEventListener('click', () => {
      const modal = document.getElementById('settings-modal');
      document.getElementById('nickname-input').value = state.currentUser.nickname || '';
      document.getElementById('sky-color').value = state.currentUser.settings?.skyColor || '#87CEEB';
      document.getElementById('land-color').value = state.currentUser.settings?.landColor || '#8B4513';
      document.getElementById('profile-preview').innerHTML = '';
      modal.classList.remove('hidden');
    });

    // 설정 저장
    document.getElementById('save-settings-btn').addEventListener('click', async () => {
      const nickname = document.getElementById('nickname-input').value.trim();
      const skyColor = document.getElementById('sky-color').value;
      const landColor = document.getElementById('land-color').value;
      const profileFile = document.getElementById('profile-image').files[0];

      let profileImage = state.currentUser.profileImage;
      if (profileFile) {
        profileImage = await imageToBase64(profileFile);
      }

      await saveSettings({
        nickname: nickname,
        profileImage: profileImage,
        settings: {
          skyColor: skyColor,
          landColor: landColor
        }
      });

      document.getElementById('settings-modal').classList.add('hidden');
    });

    // 설정 취소
    document.getElementById('cancel-settings-btn').addEventListener('click', () => {
      document.getElementById('settings-modal').classList.add('hidden');
    });

    // 프로필 이미지 미리보기
    document.getElementById('profile-image').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        const preview = document.getElementById('profile-preview');
        const img = document.createElement('img');
        img.src = await imageToBase64(file);
        preview.innerHTML = '';
        preview.appendChild(img);
      }
    });

    // 나무 심기 버튼
    document.getElementById('plant-tree-btn').addEventListener('click', () => {
      if (!state.currentUser) {
        showToast('로그인이 필요합니다. 로그인 페이지로 이동합니다.');
        setTimeout(() => {
          window.location.href = '/api/auth/google';
        }, 1000);
        return;
      }
      document.getElementById('sign-message').value = '';
      document.getElementById('sign-image').value = '';
      document.getElementById('image-preview').innerHTML = '';
      document.getElementById('plant-modal').classList.remove('hidden');
    });

    // 나무 심기 확인
    document.getElementById('confirm-plant-btn').addEventListener('click', async () => {
      const message = document.getElementById('sign-message').value.trim();
      const imageFile = document.getElementById('sign-image').files[0];

      if (!message && !imageFile) {
        showToast('메시지를 입력하거나 이미지를 첨부해주세요.');
        return;
      }

      document.getElementById('plant-modal').classList.add('hidden');
      await plantTree(message, imageFile);
    });

    // 나무 심기 취소
    document.getElementById('cancel-plant-btn').addEventListener('click', () => {
      document.getElementById('plant-modal').classList.add('hidden');
    });

    // 심기 이미지 미리보기
    document.getElementById('sign-image').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        const preview = document.getElementById('image-preview');
        const img = document.createElement('img');
        img.src = await imageToBase64(file);
        preview.innerHTML = '';
        preview.appendChild(img);
      }
    });

    // 팻말 모달 닫기
    document.getElementById('close-sign-btn').addEventListener('click', () => {
      document.getElementById('sign-modal').classList.add('hidden');
    });

    // 모달 바깥 클릭 시 닫기
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.add('hidden');
        }
      });
    });
  }

  // 앱 초기화
  async function init() {
    setupEventListeners();

    // 현재 사용자 로드
    await loadCurrentUser();

    // URL에서 토지 ID 확인
    const landId = getLandIdFromUrl();

    if (landId) {
      await loadLand(landId);
    } else {
      // 메인 페이지
      if (state.currentUser) {
        // 로그인된 상태면 자신의 토지로 이동
        window.location.href = '/land/' + state.currentUser.id;
      } else {
        // 기본 나무 표시
        renderTrees();
        updateUI();
      }
    }
  }

  // DOM 로드 후 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
