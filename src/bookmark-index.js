const bookmarkEntries = [];

function getPathMatchScore(bookmarkPathname, currentPathname) {
  if (bookmarkPathname === "/") {
    return 1;
  }
  if (currentPathname === bookmarkPathname) {
    return bookmarkPathname.length;
  }
  if (currentPathname.startsWith(bookmarkPathname + "/")) {
    return bookmarkPathname.length;
  }
  return null;
}

function buildIndexFromTree(nodes) {
  for (const node of nodes) {
    if (node.url) {
      try {
        const parsed = new URL(node.url);
        bookmarkEntries.push({
          url: node.url,
          title: node.title,
          origin: parsed.origin,
          pathname: parsed.pathname,
        });
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
  bookmarkEntries.length = 0;
  const tree = await chrome.bookmarks.getTree();
  buildIndexFromTree(tree);
}

function lookupBookmarkTitle(url) {
  try {
    const current = new URL(url);
    let bestTitle = null;
    let bestScore = -1;

    for (const entry of bookmarkEntries) {
      if (entry.origin !== current.origin) continue;

      const score = getPathMatchScore(entry.pathname, current.pathname);
      if (score == null || score <= bestScore) continue;

      bestScore = score;
      bestTitle = entry.title;
    }

    return bestTitle;
  } catch {
    return null;
  }
}
