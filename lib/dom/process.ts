export async function processDom(chunksSeen: Array<number>) {
  console.log("[BROWSERBASE] Processing DOM");
  const { chunk, chunksArray } = await pickChunk(chunksSeen);
  console.log("[BROWSERBASE] Picked chunk", chunk, chunksArray);
  console.log("[BROWSERBASE] Processing elements");
  const { outputString, selectorMap } = await processElements(chunk);
  console.log("[BROWSERBASE] Processed elements", outputString);

  return {
    outputString,
    selectorMap,
    chunk,
    chunks: chunksArray,
  };
}

export async function processAllOfDom() {
  console.log("[BROWSERBASE] Processing all of DOM");

  let allOutputString = "";
  let allSelectorMap = {};
  let chunk = 0;

  while (true) {
    const { outputString, selectorMap } = await processElements(chunk);

    if (!outputString && Object.keys(selectorMap).length === 0) {
      // No more content to process
      break;
    }

    allOutputString += outputString;
    allSelectorMap = { ...allSelectorMap, ...selectorMap };

    console.log(`[BROWSERBASE] Processed chunk ${chunk}`);
    chunk++;
  }

  console.log("[BROWSERBASE] Processed all elements");
  return {
    outputString: allOutputString,
    selectorMap: allSelectorMap,
  };
}

export async function scrollToHeight(height: number) {
  window.scrollTo({ top: height, left: 0, behavior: "smooth" });

  // Wait for scrolling to finish using the scrollend event
  await new Promise<void>((resolve) => {
    let scrollEndTimer: number;
    const handleScrollEnd = () => {
      clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => {
        window.removeEventListener("scroll", handleScrollEnd);
        resolve();
      }, 100); // Small delay to ensure scrolling has truly finished
    };

    window.addEventListener("scroll", handleScrollEnd, { passive: true });
    handleScrollEnd(); // Call once in case the scroll doesn't actually occur
  });

  // Small additional delay to allow for any post-scroll animations or adjustments
  await new Promise((resolve) => setTimeout(resolve, 200));
}

export async function processElements(chunk: number) {
  const viewportHeight = window.innerHeight;
  const chunkHeight = viewportHeight * chunk;

  // Calculate the maximum scrollable offset
  const maxScrollTop =
    document.documentElement.scrollHeight - window.innerHeight;

  // Adjust the offsetTop to not exceed the maximum scrollable offset
  const offsetTop = Math.min(chunkHeight, maxScrollTop);

  await scrollToHeight(offsetTop);

  const domString = window.document.body.outerHTML;
  if (!domString) {
    throw new Error("error selecting DOM that doesn't exist");
  }

  const candidateElements: Array<ChildNode> = [];
  const DOMQueue: Array<ChildNode> = [...document.body.childNodes];
  while (DOMQueue.length > 0) {
    const element = DOMQueue.pop();

    let shouldAddElement = false;

    if (element && isElementNode(element)) {
      const childrenCount = element.childNodes.length;

      // Always traverse child nodes
      for (let i = childrenCount - 1; i >= 0; i--) {
        const child = element.childNodes[i];
        DOMQueue.push(child as ChildNode);
      }

      // Check if element is interactive
      if (isInteractiveElement(element)) {
        if ((await isActive(element)) && isVisible(element)) {
          shouldAddElement = true;
        }
      }

      if (isLeafElement(element)) {
        if ((await isActive(element)) && isVisible(element)) {
          shouldAddElement = true;
        }
      }
    }

    if (element && isTextNode(element) && isTextVisible(element)) {
      shouldAddElement = true;
    }

    if (shouldAddElement) {
      candidateElements.push(element);
    }
  }

  let selectorMap: Record<number, string> = {};
  let outputString = "";

  candidateElements.forEach((element, index) => {
    const xpath = generateXPath(element);
    if (isTextNode(element)) {
      outputString += `${index}:${element.textContent.trim()}\n`;
    } else if (isElementNode(element)) {
      const tagName = element.tagName.toLowerCase();

      // Collect essential attributes
      const attributes: string[] = [];
      if (element.id) {
        attributes.push(`id="${element.id}"`);
      }
      if (element.className) {
        attributes.push(`class="${element.className}"`);
      }
      if (element.getAttribute("href")) {
        attributes.push(`href="${element.getAttribute("href")}"`);
      }
      if (element.getAttribute("src")) {
        attributes.push(`src="${element.getAttribute("src")}"`);
      }
      if (element.getAttribute("aria-label")) {
        attributes.push(`aria-label="${element.getAttribute("aria-label")}"`);
      }
      if (element.getAttribute("aria-name")) {
        attributes.push(`aria-name="${element.getAttribute("aria-name")}"`);
      }
      if (element.getAttribute("aria-role")) {
        attributes.push(`aria-role="${element.getAttribute("aria-role")}"`);
      }
      if (element.getAttribute("aria-description")) {
        attributes.push(
          `aria-description="${element.getAttribute("aria-description")}"`,
        );
      }
      if (element.getAttribute("aria-expanded")) {
        attributes.push(
          `aria-expanded="${element.getAttribute("aria-expanded")}"`,
        );
      }
      if (element.getAttribute("aria-haspopup")) {
        attributes.push(
          `aria-haspopup="${element.getAttribute("aria-haspopup")}"`,
        );
      }

      for (const attr of element.attributes) {
        if (attr.name.startsWith("data-")) {
          attributes.push(`${attr.name}="${attr.value}"`);
        }
      }

      // Build the simplified element string
      const openingTag = `<${tagName}${
        attributes.length > 0 ? " " + attributes.join(" ") : ""
      }>`;
      const closingTag = `</${tagName}>`;
      const textContent = element.textContent.trim();

      outputString += `${index}:${openingTag}${textContent}${closingTag}\n`;
    }

    selectorMap[index] = xpath;
  });

  return {
    outputString,
    selectorMap,
  };
}

window.processDom = processDom;
window.processAllOfDom = processAllOfDom;
window.processElements = processElements;
window.scrollToHeight = scrollToHeight;

export function generateXPath(element: ChildNode): string {
  if (isElementNode(element) && element.id) {
    return `//*[@id='${element.id}']`;
  }

  const parts: string[] = [];
  while (element && (isTextNode(element) || isElementNode(element))) {
    let index = 0;
    let hasSameTypeSiblings = false;
    const siblings = element.parentElement
      ? Array.from(element.parentElement.childNodes)
      : [];

    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];

      if (
        sibling.nodeType === element.nodeType &&
        sibling.nodeName === element.nodeName
      ) {
        index = index + 1;
        hasSameTypeSiblings = true;

        if (sibling.isSameNode(element)) {
          break;
        }
      }
    }

    // text "nodes" are selected differently than elements with xPaths
    if (element.nodeName !== "#text") {
      const tagName = element.nodeName.toLowerCase();
      const pathIndex = hasSameTypeSiblings ? `[${index}]` : "";
      parts.unshift(`${tagName}${pathIndex}`);
    }

    element = element.parentElement as HTMLElement;
  }

  return parts.length ? `/${parts.join("/")}` : "";
}

const leafElementDenyList = ["SVG", "IFRAME", "SCRIPT", "STYLE", "LINK"];

const interactiveElementTypes = [
  "A",
  "BUTTON",
  "DETAILS",
  "EMBED",
  "INPUT",
  "LABEL",
  "MENU",
  "MENUITEM",
  "OBJECT",
  "SELECT",
  "TEXTAREA",
  "SUMMARY",
];

const interactiveRoles = [
  "button",
  "menu",
  "menuitem",
  "link",
  "checkbox",
  "radio",
  "slider",
  "tab",
  "tabpanel",
  "textbox",
  "combobox",
  "grid",
  "listbox",
  "option",
  "progressbar",
  "scrollbar",
  "searchbox",
  "switch",
  "tree",
  "treeitem",
  "spinbutton",
  "tooltip",
];
const interactiveAriaRoles = ["menu", "menuitem", "button"];

export function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

export function isTextNode(node: Node): node is Text {
  // trim all white space and make sure the text node is non empty to consider it legit
  const trimmedText = node.textContent?.trim().replace(/\s/g, "");
  return node.nodeType === Node.TEXT_NODE && trimmedText !== "";
}

/*
 * Checks if an element is visible and therefore relevant for LLMs to consider. We check:
 * - size
 * - display properties
 * - opacity
 * If the element is a child of a previously hidden element, it should not be included, so we don't consider downstream effects of a parent element here
 */
export const isVisible = (element: Element) => {
  const rect = element.getBoundingClientRect();
  // this number is relative to scroll, so we shouldn't be using an absolute offset, we can use the viewport height
  if (
    rect.width === 0 ||
    rect.height === 0 ||
    // we take elements by their starting top. so if you start before our offset, or after our offset, you don't count!
    rect.top < 0 ||
    rect.top > window.innerHeight
  ) {
    return false;
  }
  if (!isTopElement(element, rect)) {
    return false;
  }

  const isVisible = element.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  });

  return isVisible;
};

export const isTextVisible = (element: ChildNode) => {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();

  if (
    rect.width === 0 ||
    rect.height === 0 ||
    // we take elements by their starting top. so if you start before our offset, or after our offset, you don't count!
    rect.top < 0 ||
    rect.top > window.innerHeight
  ) {
    return false;
  }
  const parent = element.parentElement;
  if (!parent) {
    return false;
  }
  if (!isTopElement(parent, rect)) {
    return false;
  }

  const isVisible = parent.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  });

  return isVisible;
};

export function isTopElement(elem: ChildNode, rect: DOMRect) {
  const points = [
    { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.25 },
    { x: rect.left + rect.width * 0.75, y: rect.top + rect.height * 0.25 },
    { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.75 },
    { x: rect.left + rect.width * 0.75, y: rect.top + rect.height * 0.75 },
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
  ];

  return points.some((point) => {
    const topEl = document.elementFromPoint(point.x, point.y);
    let current = topEl;
    while (current && current !== document.body) {
      if (current.isSameNode(elem)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  });
}

export const isActive = async (element: Element) => {
  if (
    element.hasAttribute("disabled") ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }

  return true;
};
export const isInteractiveElement = (element: Element) => {
  const elementType = element.tagName;
  const elementRole = element.getAttribute("role");
  const elementAriaRole = element.getAttribute("aria-role");

  return (
    (elementType && interactiveElementTypes.includes(elementType)) ||
    (elementRole && interactiveRoles.includes(elementRole)) ||
    (elementAriaRole && interactiveAriaRoles.includes(elementAriaRole))
  );
};

export const isLeafElement = (element: Element) => {
  if (element.textContent === "") {
    return false;
  }

  if (element.childNodes.length === 0) {
    return !leafElementDenyList.includes(element.tagName);
  }

  // This case ensures that extra context will be included for simple element nodes that contain only text
  if (element.childNodes.length === 1 && isTextNode(element.childNodes[0])) {
    return true;
  }

  return false;
};

export async function pickChunk(chunksSeen: Array<number>) {
  const viewportHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;

  const chunks = Math.ceil(documentHeight / viewportHeight);

  const chunksArray = Array.from({ length: chunks }, (_, i) => i);
  const chunksRemaining = chunksArray.filter((chunk) => {
    return !chunksSeen.includes(chunk);
  });

  const currentScrollPosition = window.scrollY;
  const closestChunk = chunksRemaining.reduce((closest, current) => {
    const currentChunkTop = viewportHeight * current;
    const closestChunkTop = viewportHeight * closest;
    return Math.abs(currentScrollPosition - currentChunkTop) <
      Math.abs(currentScrollPosition - closestChunkTop)
      ? current
      : closest;
  }, chunksRemaining[0]);
  const chunk = closestChunk;

  if (chunk === undefined) {
    throw new Error(`no chunks remaining to check ${chunksRemaining}, `);
  }
  return {
    chunk,
    chunksArray,
  };
}
