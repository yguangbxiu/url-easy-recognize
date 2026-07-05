(() => {
  if (globalThis.__URL_EASY_RECOGNIZE__) return;
  globalThis.__URL_EASY_RECOGNIZE__ = true;

let bookmarkTitle = null;
let titleObserver = null;
let headObserver = null;
let reapplyTimer = null;

function applyTitle() {
  if (bookmarkTitle) {
    document.title = bookmarkTitle;
  }
}

function scheduleReapply() {
  if (!bookmarkTitle || document.title === bookmarkTitle) return;
  clearTimeout(reapplyTimer);
  reapplyTimer = setTimeout(() => {
    if (bookmarkTitle && document.title !== bookmarkTitle) {
      document.title = bookmarkTitle;
    }
  }, 100);
}

function observeTitleElement(titleEl) {
  if (titleObserver) return;

  titleObserver = new MutationObserver(scheduleReapply);
  titleObserver.observe(titleEl, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

function ensureTitleObserver() {
  if (!bookmarkTitle || titleObserver) return;

  const titleEl = document.querySelector("title");
  if (titleEl) {
    observeTitleElement(titleEl);
    return;
  }

  if (headObserver) return;

  headObserver = new MutationObserver(() => {
    const el = document.querySelector("title");
    if (!el) return;
    headObserver.disconnect();
    headObserver = null;
    observeTitleElement(el);
    applyTitle();
  });

  const head = document.head || document.documentElement;
  headObserver.observe(head, { childList: true, subtree: true });
}

function disconnectObservers() {
  if (titleObserver) {
    titleObserver.disconnect();
    titleObserver = null;
  }
  if (headObserver) {
    headObserver.disconnect();
    headObserver = null;
  }
  clearTimeout(reapplyTimer);
  reapplyTimer = null;
}

function setBookmarkTitle(title) {
  bookmarkTitle = title;
  applyTitle();
  ensureTitleObserver();
}

function clearBookmarkTitle() {
  bookmarkTitle = null;
  disconnectObservers();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SET_BOOKMARK_TITLE") {
    setBookmarkTitle(message.title);
  } else if (message.type === "CLEAR_BOOKMARK_TITLE") {
    clearBookmarkTitle();
  }
});
})();
