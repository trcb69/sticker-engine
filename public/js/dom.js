/**
 * A very small DOM helper. Not a framework — just enough to stop the component
 * files being three quarters `document.createElement`.
 */

/**
 * @param {string} tag Tag name, optionally with `.class` suffixes.
 * @param {Record<string, unknown>} [attrs]
 * @param {(Node|string|null|false)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = `${node.className} ${value}`.trim();
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** @param {HTMLElement} node */
export function clear(node) {
  // replaceChildren rather than removing one at a time: a re-render can be
  // triggered from a blur handler, and removing the very node that is losing
  // focus throws part-way through, leaving the panel half rebuilt.
  node.replaceChildren();
  return node;
}

/**
 * @param {HTMLElement} node
 * @param {(Node|string|null|false)[]} children
 */
export function replace(node, children) {
  const nodes = children.flat()
    .filter((child) => child !== null && child !== undefined && child !== false)
    .map((child) => (child instanceof Node ? child : document.createTextNode(String(child))));
  node.replaceChildren(...nodes);
  return node;
}
