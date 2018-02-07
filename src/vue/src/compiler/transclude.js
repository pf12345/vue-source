import { parseText } from '../parsers/text'
import { parseTemplate } from '../parsers/template'
import {
  warn,
  isTemplate,
  isFragment,
  prepend,
  extractContent,
  createAnchor,
  resolveAsset,
  toArray,
  addClass,
  hasBindAttr
} from '../util/index'

const specialCharRE = /[^\w\-:\.]/

/**
 * Process an element or a DocumentFragment based on a
 * instance option object. This allows us to transclude
 * a template node/fragment before the instance is created,
 * so the processed fragment can then be cloned and reused
 * in v-for.
 *
 * @param {Element} el
 * @param {Object} options
 * @return {Element|DocumentFragment}
 */

export function transclude (el, options) {
  // extract container attributes to pass them down
  // to compiler, because they need to be compiled in
  // parent scope. we are mutating the options object here
  // assuming the same object will be used for compile
  // right after this.
  if (options) {
    // 把el(虚拟节点，如<hello></hello>)元素上的所有attributes抽取出来存放在了选项对象的_containerAttrs属性上
    // 使用el.attributes 方法获取el上面，并使用toArray方法，将类数组转换为真实数组
    options._containerAttrs = extractAttrs(el)
  }
  // for template tags, what we want is its content as
  // a documentFragment (for fragment instances)
  // 判断是否为 template 标签
  if (isTemplate(el)) {
    // 得到一段存放在documentFragment里的真实dom
    el = parseTemplate(el)
  }
  if (options) {
    if (options._asComponent && !options.template) {
      options.template = '<slot></slot>'
    }
    if (options.template) {
      // 将el的内容（子元素和文本节点）抽取出来
      options._content = extractContent(el)
      // 使用options.template 将虚拟节点转化为真实html， <hello></hello> => <div><h1>hello {{ msg }}</h1></div>
      // 但不包括未绑定数据, 则上面转化为 => <div><h1>hello</h1></div>
      el = transcludeTemplate(el, options)
    }
  }
  // isFragment: node is a DocumentFragment
  // 使用nodeType 为 11 进行判断
  if (isFragment(el)) {
    // anchors for fragment instance
    // passing in `persist: true` to avoid them being
    // discarded by IE during template cloning
    prepend(createAnchor('v-start', true), el)
    el.appendChild(createAnchor('v-end', true))
  }
  return el
}

/**
 * Process the template option.
 * If the replace option is true this will swap the $el.
 *
 * @param {Element} el
 * @param {Object} options
 * @return {Element|DocumentFragment}
 */

function transcludeTemplate (el, options) {
  var template = options.template
  //将文本模板或节点转化为文档片段，并保存到缓存
  var frag = parseTemplate(template, true)
  if (frag) {
    var replacer = frag.firstChild
    if (!replacer) {
      return frag
    }
    var tag = replacer.tagName && replacer.tagName.toLowerCase()
    if (options.replace) {
      /* istanbul ignore if */
      if (el === document.body) {
        process.env.NODE_ENV !== 'production' && warn(
          'You are mounting an instance with a template to ' +
          '<body>. This will replace <body> entirely. You ' +
          'should probably use `replace: false` here.'
        )
      }
      // there are many cases where the instance must
      // become a fragment instance: basically anything that
      // can create more than 1 root nodes.
      if (
        // multi-children template
        frag.childNodes.length > 1 ||
        // non-element template
        replacer.nodeType !== 1 ||
        // single nested component
        tag === 'component' ||
        resolveAsset(options, 'components', tag) ||
        hasBindAttr(replacer, 'is') ||
        // element directive
        resolveAsset(options, 'elementDirectives', tag) ||
        // for block
        replacer.hasAttribute('v-for') ||
        // if block
        replacer.hasAttribute('v-if')
      ) {
        return frag
      } else {
        // 获取虚拟节点对应的真实html，如<hello></hello> 对应html: 
        /*<div class="hello">
          <h1>hello {{ msg }} welcome here</h1>
          <h3 v-if="show">this is v-if</h3>
        </div>*/
        // 对应的属性，如class＝“hello”
        options._replacerAttrs = extractAttrs(replacer)
        mergeAttrs(el, replacer)
        return replacer
      }
    } else {
      el.appendChild(frag)
      return el
    }
  } else {
    process.env.NODE_ENV !== 'production' && warn(
      'Invalid template option: ' + template
    )
  }
}

/**
 * Helper to extract a component container's attributes
 * into a plain object array.
 * 使用el.attributes 方法获取el上面，并使用toArray方法，将类数组转换为真实数组
 * 
 * @param {Element} el
 * @return {Array}
 */

function extractAttrs (el) {
  // 只查找元素节点及有属性
  if (el.nodeType === 1 && el.hasAttributes()) {
    // attributes 属性返回指定节点的属性集合，即 NamedNodeMap, 类数组
    return toArray(el.attributes)
  }
}

/**
 * Merge the attributes of two elements, and make sure
 * the class names are merged properly.
 *
 * @param {Element} from
 * @param {Element} to
 */

function mergeAttrs (from, to) {
  var attrs = from.attributes
  var i = attrs.length
  var name, value
  while (i--) {
    name = attrs[i].name
    value = attrs[i].value
    if (!to.hasAttribute(name) && !specialCharRE.test(name)) {
      to.setAttribute(name, value)
    } else if (name === 'class' && !parseText(value) && (value = value.trim())) {
      value.split(/\s+/).forEach(function (cls) {
        addClass(to, cls)
      })
    }
  }
}
