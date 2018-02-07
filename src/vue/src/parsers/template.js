import Cache from '../cache'
import {
  inBrowser,
  trimNode,
  isTemplate,
  isFragment
} from '../util/index'

const templateCache = new Cache(1000)
const idSelectorCache = new Cache(1000)

const map = {
  efault: [0, '', ''],
  legend: [1, '<fieldset>', '</fieldset>'],
  tr: [2, '<table><tbody>', '</tbody></table>'],
  col: [
    2,
    '<table><tbody></tbody><colgroup>',
    '</colgroup></table>'
  ]
}

map.td =
map.th = [
  3,
  '<table><tbody><tr>',
  '</tr></tbody></table>'
]

map.option =
map.optgroup = [
  1,
  '<select multiple="multiple">',
  '</select>'
]

map.thead =
map.tbody =
map.colgroup =
map.caption =
map.tfoot = [1, '<table>', '</table>']

map.g =
map.defs =
map.symbol =
map.use =
map.image =
map.text =
map.circle =
map.ellipse =
map.line =
map.path =
map.polygon =
map.polyline =
map.rect = [
  1,
  '<svg ' +
    'xmlns="http://www.w3.org/2000/svg" ' +
    'xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    'xmlns:ev="http://www.w3.org/2001/xml-events"' +
    'version="1.1">',
  '</svg>'
]

/**
 * Check if a node is a supported template node with a
 * DocumentFragment content.
 * 判断是否为template节点或文档片段
 *
 * @param {Node} node
 * @return {Boolean}
 */

function isRealTemplate (node) {
  return isTemplate(node) && isFragment(node.content)
}

const tagRE = /<([\w:-]+)/
const entityRE = /&#?\w+?;/
const commentRE = /<!--/

/**
 * Convert a string template to a DocumentFragment.
 * Determines correct wrapping by tag types. Wrapping
 * strategy found in jQuery & component/domify.
 * 将html字符串转化为文档片段，并保存在缓存中
 *
 * @param {String} templateString
 * @param {Boolean} raw
 * @return {DocumentFragment}
 */

function stringToFragment (templateString, raw) {
  // try a cache hit first
  var cacheKey = raw
    ? templateString
    : templateString.trim() //trim() 方法会从一个字符串的两端删除空白字符
  var hit = templateCache.get(cacheKey)
  if (hit) {
    return hit
  }
  // 创建一个文档片段
  var frag = document.createDocumentFragment()
  // tagRE: /<([\w:-]+)/
  // 匹配标签
  // '<test v-if="ok"></test>'.match(/<([\w:-]+)/) => ["<test", "test", index: 0, input: "<test v-if="ok"></test>"]
  var tagMatch = templateString.match(tagRE)
  // entityRE: /&#?\w+?;/
  var entityMatch = entityRE.test(templateString)
  // commentRE: /<!--/ 
  // 匹配注释
  var commentMatch = commentRE.test(templateString) 

  if (!tagMatch && !entityMatch && !commentMatch) {
    // text only, return a single text node.
    // 如果都没匹配到，创建一个文本节点添加到文档片段
    frag.appendChild(
      document.createTextNode(templateString)
    )
  } else {
    var tag = tagMatch && tagMatch[1]
    // map, 对标签进行修正；如是td标签，则返回"<table><tbody><tr>" + templateString +  "</tr></tbody></table>";
    // map['td'] = [3, "<table><tbody><tr>", "</tr></tbody></table>"]
    var wrap = map[tag] || map.efault
    var depth = wrap[0]
    var prefix = wrap[1]
    var suffix = wrap[2]
    var node = document.createElement('div')

    node.innerHTML = prefix + templateString + suffix

    while (depth--) {
      node = node.lastChild
    }

    var child
    document.body.appendChild(node);
    /* eslint-disable no-cond-assign */
    while (child = node.firstChild) {
    /* eslint-enable no-cond-assign */
      frag.appendChild(child)
    }
  }
  if (!raw) {
    // 移除文档中空文本节点及注释节点
    trimNode(frag)
  }
  templateCache.put(cacheKey, frag)
  return frag
}

/**
 * Convert a template node to a DocumentFragment.
 * 将元素节点转化为文档片段，但是不保存至缓存
 *
 * @param {Node} node
 * @return {DocumentFragment}
 */

function nodeToFragment (node) {
  // if its a template tag and the browser supports it,
  // its content is already a document fragment. However, iOS Safari has
  // bug when using directly cloned template content with touch
  // events and can cause crashes when the nodes are removed from DOM, so we
  // have to treat template elements as string templates. (#2805)
  /* istanbul ignore if */
  // 是template元素或者documentFragment，使用stringToFragment转化并保存节点内容
  if (isRealTemplate(node)) {
    return stringToFragment(node.innerHTML)
  }
  // script template
  if (node.tagName === 'SCRIPT') {
    return stringToFragment(node.textContent)
  }
  // normal node, clone it to avoid mutating the original
  var clonedNode = cloneNode(node)
  var frag = document.createDocumentFragment()
  var child
  /* eslint-disable no-cond-assign */
  while (child = clonedNode.firstChild) {
  /* eslint-enable no-cond-assign */
    frag.appendChild(child)
  }
  trimNode(frag)
  return frag
}

// Test for the presence of the Safari template cloning bug
// https://bugs.webkit.org/showug.cgi?id=137755
var hasBrokenTemplate = (function () {
  /* istanbul ignore else */
  if (inBrowser) {
    var a = document.createElement('div')
    a.innerHTML = '<template>1</template>'
    return !a.cloneNode(true).firstChild.innerHTML
  } else {
    return false
  }
})()

// Test for IE10/11 textarea placeholder clone bug
var hasTextareaCloneBug = (function () {
  /* istanbul ignore else */
  if (inBrowser) {
    var t = document.createElement('textarea')
    t.placeholder = 't'
    return t.cloneNode(true).value === 't'
  } else {
    return false
  }
})()

/**
 * 1. Deal with Safari cloning nested <template> bug by
 *    manually cloning all template instances.
 * 2. Deal with IE10/11 textarea placeholder bug by setting
 *    the correct value after cloning.
 *
 * @param {Element|DocumentFragment} node
 * @return {Element|DocumentFragment}
 */

export function cloneNode (node) {
  /* istanbul ignore if */
  if (!node.querySelectorAll) {
    return node.cloneNode()
  }
  var res = node.cloneNode(true)
  var i, original, cloned
  /* istanbul ignore if */
  if (hasBrokenTemplate) {
    var tempClone = res
    if (isRealTemplate(node)) {
      node = node.content
      tempClone = res.content
    }
    original = node.querySelectorAll('template')
    if (original.length) {
      cloned = tempClone.querySelectorAll('template')
      i = cloned.length
      while (i--) {
        cloned[i].parentNode.replaceChild(
          cloneNode(original[i]),
          cloned[i]
        )
      }
    }
  }
  /* istanbul ignore if */
  if (hasTextareaCloneBug) {
    if (node.tagName === 'TEXTAREA') {
      res.value = node.value
    } else {
      original = node.querySelectorAll('textarea')
      if (original.length) {
        cloned = res.querySelectorAll('textarea')
        i = cloned.length
        while (i--) {
          cloned[i].value = original[i].value
        }
      }
    }
  }
  return res
}

/**
 * Process the template option and normalizes it into a
 * a DocumentFragment that can be used as a partial or a
 * instance template.
 *
 * @param {*} template
 *        Possible values include:
 *        - DocumentFragment object
 *        - Node object of type Template
 *        - id selector: '#some-template-id'
 *        - template string: '<div><span>{{msg}}</span></div>'
 * @param {Boolean} shouldClone
 * @param {Boolean} raw
 *        inline HTML interpolation. Do not check for id
 *        selector and keep whitespace in the string.
 * @return {DocumentFragment|undefined}
 */

export function parseTemplate (template, shouldClone, raw) {
  var node, frag

  // if the template is already a document fragment,
  // do nothing
  // 是否为文档片段, nodetype是否为11
  // https://developer.mozilla.org/zh-CN/docs/Web/API/DocumentFragment
  if (isFragment(template)) {
    trimNode(template)
    return shouldClone
      ? cloneNode(template)
      : template
  }
  if (typeof template === 'string') {
    // id selector
    if (!raw && template.charAt(0) === '#') {
      // id selector can be cached too
      frag = idSelectorCache.get(template)
      if (!frag) {
        node = document.getElementById(template.slice(1))
        if (node) {
          frag = nodeToFragment(node)
          // save selector to cache
          idSelectorCache.put(template, frag)
        }
      }
    } else {
      // normal string template
      frag = stringToFragment(template, raw)
    }
  } else if (template.nodeType) {
    // a direct node
    frag = nodeToFragment(template)
  }

  return frag && shouldClone
    ? cloneNode(frag)
    : frag
}
