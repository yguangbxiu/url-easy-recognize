const originIndex = new Map();

function buildIndexFromTree(nodes) {
  for (const node of nodes) {
    if (node.url) {
      try {
        const origin = new URL(node.url).origin;
        if (!originIndex.has(origin)) {
          originIndex.set(origin, node.title);
        }
      } catch {
        // skip invalid bookmark URLs (e.g. javascript:)
      }
    }
    if (node.children) {
      buildIndexFromTree(node.children);
    }
  }
}

async function refreshBookmarkIndex() {
  originIndex.clear();
  const tree = await chrome.bookmarks.getTree();
  buildIndexFromTree(tree);
}

function lookupBookmarkTitle(url) {
  try {
    const origin = new URL(url).origin;
    return originIndex.get(origin) ?? null;
  } catch {
    return null;
  }
}
