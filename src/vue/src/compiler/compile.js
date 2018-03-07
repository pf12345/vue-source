import publicDirectives from '../directives/public/index'
import internalDirectives from '../directives/internal/index'
import { compileProps } from './compile-props'
import { parseText, tokensToExp } from '../parsers/text'
import { parseDirective } from '../parsers/directive'
import { parseTemplate } from '../parsers/template'
import {
  _toString,
  resolveAsset,
  toArray,
  warn,
  remove,
  replace,
  commonTagRE,
  checkComponentAttr,
  findRef,
  defineReactive,
  getAttr
} from '../util/index'

// special binding prefixes
const bindRE = /^v-bind:|^:/
const onRE = /^v-on:|^@/
const dirAttrRE = /^v-([^:]+)(?:$|:(.*)$)/
const modifierRE = /\.[^\.]+/g
const transitionRE = /^(v-bind:|:)?transition$/

// default directive priority
const DEFAULT_PRIORITY = 1000
const DEFAULT_TERMINAL_PRIORITY = 2000

/**
 * Compile a template and return a reusable composite link
 * function, which recursively contains more link functions
 * inside. This top level compile function would normally
 * be called on instance root nodes, but can also be used
 * for partial compilation if the partial argument is true.
 *
 * The returned composite link function, when called, will
 * return an unlink function that tearsdown all directives
 * created during the linking phase.
 *
 * @param {Element|DocumentFragment} el
 * @param {Object} options
 * @param {Boolean} partial
 * @return {Function}
 */

 export function compile (el, options, partial) {
  // link function for the node itself.
  var nodeLinkFn = partial || !options._asComponent
  ? compileNode(el, options)
  : null
  // link function for the childNodes
  var childLinkFn =
  !(nodeLinkFn && nodeLinkFn.terminal) &&
  !isScript(el) &&
  el.hasChildNodes()
  ? compileNodeList(el.childNodes, options)
  : null

  /**
   * A composite linker function to be called on a already
   * compiled piece of DOM, which instantiates all directive
   * instances.
   *
   * @param {Vue} vm
   * @param {Element|DocumentFragment} el
   * @param {Vue} [host] - host vm of transcluded content
   * @param {Object} [scope] - v-for scope
   * @param {Fragment} [frag] - link context fragment
   * @return {Function|undefined}
   */

   return function compositeLinkFn (vm, el, host, scope, frag) {
    // cache childNodes before linking parent, fix #657
    var childNodes = toArray(el.childNodes)
    // link
    var dirs = linkAndCapture(function compositeLinkCapturer () {
      if (nodeLinkFn) nodeLinkFn(vm, el, host, scope, frag)
        if (childLinkFn) childLinkFn(vm, childNodes, host, scope, frag)
      }, vm)
    return makeUnlinkFn(vm, dirs)
  }
}

/**
 * Apply a linker to a vm/element pair and capture the
 * directives created during the process.
 *
 * @param {Function} linker
 * @param {Vue} vm
 */

 // link函数的执行过程会生成新的Directive实例,push到_directives数组中
// 而这些_directives并没有建立对应的watcher,watcher也没有收集依赖,
// 一切都还处于初始阶段,因此capture阶段需要找到这些新添加的directive,
// 依次执行_bind,在_bind里会进行watcher生成,执行指令的bind和update,完成响应式构建
 function linkAndCapture (linker, vm) {
  /* istanbul ignore if */
  if (process.env.NODE_ENV === 'production') {
    // reset directives before every capture in production
    // mode, so that when unlinking we don't need to splice
    // them out (which turns out to be a perf hit).
    // they are kept in development mode because they are
    // useful for Vue's own tests.
    vm._directives = []
  }
  // 先记录下数组里原先有多少元素,他们都是已经执行过_bind的,我们只_bind新添加的directive
  var originalDirCount = vm._directives.length
  // 在生成的linker中，会对元素的属性进行指令化处理，并保存到_directives中
  linker()
  // slice出新添加的指令们
  var dirs = vm._directives.slice(originalDirCount)
  // 根据 priority 进行排序
  // 对指令进行优先级排序,使得后面指令的bind过程是按优先级从高到低进行的
  sortDirectives(dirs)
  for (var i = 0, l = dirs.length; i < l; i++) {
    dirs[i]._bind()
  }
  return dirs
}

/**
 * sort directives by priority (stable sort)
 *
 * @param {Array} dirs
 */
 function sortDirectives (dirs) {
  if (dirs.length === 0) return

    var groupedMap = {}
  var i, j, k, l
  var index = 0
  var priorities = []
  for (i = 0, j = dirs.length; i < j; i++) {
    var dir = dirs[i]
    var priority = dir.descriptor.def.priority || DEFAULT_PRIORITY // DEFAULT_PRIORITY: 1000
    var array = groupedMap[priority]
    if (!array) {
      array = groupedMap[priority] = []
      priorities.push(priority)
    }
    array.push(dir)
  }

  priorities.sort(function (a, b) {
    return a > b ? -1 : a === b ? 0 : 1
  })
  for (i = 0, j = priorities.length; i < j; i++) {
    var group = groupedMap[priorities[i]]
    for (k = 0, l = group.length; k < l; k++) {
      dirs[index++] = group[k]
    }
  }
}

/**
 * Linker functions return an unlink function that
 * tearsdown all directives instances generated during
 * the process.
 *
 * We create unlink functions with only the necessary
 * information to avoid retaining additional closures.
 *
 * @param {Vue} vm
 * @param {Array} dirs
 * @param {Vue} [context]
 * @param {Array} [contextDirs]
 * @return {Function}
 */

 function makeUnlinkFn (vm, dirs, context, contextDirs) {
  function unlink (destroying) {
    teardownDirs(vm, dirs, destroying)
    if (context && contextDirs) {
      teardownDirs(context, contextDirs)
    }
  }
  // expose linked directives
  unlink.dirs = dirs
  return unlink
}

/**
 * Teardown partial linked directives.
 *
 * @param {Vue} vm
 * @param {Array} dirs
 * @param {Boolean} destroying
 */

 function teardownDirs (vm, dirs, destroying) {
  var i = dirs.length
  while (i--) {
    dirs[i]._teardown()
    if (process.env.NODE_ENV !== 'production' && !destroying) {
      vm._directives.$remove(dirs[i])
    }
  }
}

/**
 * Compile link props on an instance.
 *
 * @param {Vue} vm
 * @param {Element} el
 * @param {Object} props
 * @param {Object} [scope]
 * @return {Function}
 */

 export function compileAndLinkProps (vm, el, props, scope) {
  var propsLinkFn = compileProps(el, props, vm)
  var propDirs = linkAndCapture(function () {
    propsLinkFn(vm, scope)
  }, vm)
  return makeUnlinkFn(vm, propDirs)
}

/**
 * Compile the root element of an instance.
 *
 * 1. attrs on context container (context scope)
 * 2. attrs on the component template root node, if
 *    replace:true (child scope)
 *
 * If this is a fragment instance, we only need to compile 1.
 *
 * @param {Element} el
 * @param {Object} options
 * @param {Object} contextOptions
 * @return {Function}
 */

 export function compileRoot (el, options, contextOptions) {
  //el(虚拟元素，如<hello></hello>)元素上的所有attributes
  // <hello @click.stop="hello" style="color: red" class="hello" :class="{'selected': true}"></hello>
  // ['@click.stop', 'style', 'class', ':class']
  var containerAttrs = options._containerAttrs 

  // 虚拟元素对应真实html根元素所有attributes
  // <div class="hello"> ... </div>
  // ['class', '_v-b9ed5d18']
  var replacerAttrs = options._replacerAttrs // 虚拟元素对应真实html
  var contextLinkFn, replacerLinkFn
  // only need to compile other attributes for
  // non-fragment instances
  // el不是文档片段
  if (el.nodeType !== 11) {
    // for components, container and replacer need to be
    // compiled separately and linked in different scopes.
    // 元素是否为组件,如果为组件，则组件元素、组件元素中根元素都需要编译，如果不为组件，则只需要编译元素根元素
    if (options._asComponent) {
      // 2. container attributes
      if (containerAttrs && contextOptions) {
        contextLinkFn = compileDirectives(containerAttrs, contextOptions)
      }
      if (replacerAttrs) {
        // 3. replacer attributes
        replacerLinkFn = compileDirectives(replacerAttrs, options)
      }
    } else {
      // non-component, just compile as a normal element.
      replacerLinkFn = compileDirectives(el.attributes, options)
    }
  } else if (process.env.NODE_ENV !== 'production' && containerAttrs) {
    // warn container directives for fragment instances
    var names = containerAttrs
    .filter(function (attr) {
        // allow vue-loader/vueify scoped css attributes
        return attr.name.indexOf('_v-') < 0 &&
          // allow event listeners
          !onRE.test(attr.name) &&
          // allow slots
          attr.name !== 'slot'
        })
    .map(function (attr) {
      return '"' + attr.name + '"'
    })
    if (names.length) {
      var plural = names.length > 1

      var componentName = options.el.tagName.toLowerCase()
      if (componentName === 'component' && options.name) {
        componentName += ':' + options.name
      }

      warn(
        'Attribute' + (plural ? 's ' : ' ') + names.join(', ') +
        (plural ? ' are' : ' is') + ' ignored on component ' +
        '<' + componentName + '> because ' +
        'the component is a fragment instance: ' +
        'http://vuejs.org/guide/components.html#Fragment-Instance'
        )
    }
  }

  options._containerAttrs = options._replacerAttrs = null
  return function rootLinkFn (vm, el, scope) {
    // link context scope dirs
    var context = vm._context
    var contextDirs
    if (context && contextLinkFn) {
      contextDirs = linkAndCapture(function () {
        contextLinkFn(context, el, null, scope)
      }, context)
    }

    // link self
    var selfDirs = linkAndCapture(function () {
      if (replacerLinkFn) replacerLinkFn(vm, el)
    }, vm)


    // return the unlink function that tearsdown context
    // container directives.
    return makeUnlinkFn(vm, selfDirs, context, contextDirs)
  }
}

/**
 * Compile a node and return a nodeLinkFn based on the
 * node type.
 *
 * @param {Node} node
 * @param {Object} options
 * @return {Function|null}
 */

 function compileNode (node, options) {
  var type = node.nodeType
  if (type === 1 && !isScript(node)) {
    return compileElement(node, options)
  } else if (type === 3 && node.data.trim()) {
    return compileTextNode(node, options)
  } else {
    return null
  }
}

/**
 * Compile an element and return a nodeLinkFn.
 *
 * @param {Element} el
 * @param {Object} options
 * @return {Function|null}
 * 查找使用什么方式编译，并返回对应的编译函数
 */

 function compileElement (el, options) {
  // preprocess textareas.
  // textarea treats its text content as the initial value.
  // just bind it as an attr directive for value.

  // textarea元素是把tag中间的内容当做了他的value,这和input什么的不太一样
  // 因此大家写模板的时候通常是这样写: <textarea>{{hello}}</textarea>
  // 但是template转换成dom之后,这个内容跑到了textarea元素的value属性上,tag中间的内容是空的,
  // 因此遇到textarea的时候需要单独编译一下它的value
  if (el.tagName === 'TEXTAREA') {
    // a textarea which has v-pre attr should skip complie.
    if (getAttr(el, 'v-pre') !== null) {
      return skip
    }
    var tokens = parseText(el.value)
    if (tokens) {
      el.setAttribute(':value', tokensToExp(tokens))
      el.value = ''
    }
  }
  var linkFn
  var hasAttrs = el.hasAttributes()
  var attrs = hasAttrs && toArray(el.attributes)
  // check terminal directives (for & if)
  // 是否可以使用原生的options.directives进行编译
  if (hasAttrs) {
    linkFn = checkTerminalDirectives(el, attrs, options)
  }
  // check element directives
  // 是否可以使用options.elementDirectives进行编译
  if (!linkFn) {
    linkFn = checkElementDirectives(el, options)
  }
  // check component
  // 是否可以使用options.components
  if (!linkFn) {
    linkFn = checkComponent(el, options)
  }
  // normal directives
  if (!linkFn && hasAttrs) {
    linkFn = compileDirectives(attrs, options)
  }
  return linkFn
}

/**
 * Compile a textNode and return a nodeLinkFn.
 *
 * @param {TextNode} node
 * @param {Object} options
 * @return {Function|null} textNodeLinkFn
 */

 function compileTextNode (node, options) {
  // skip marked text nodes
  if (node._skip) {
    return removeText
  }

  var tokens = parseText(node.wholeText)
  // 没有token就意味着没有插值,
 // 没有插值那么内容不需要任何更改,也不会是响应式的数据
  if (!tokens) {
    return null
  }

  // mark adjacent text nodes as skipped,
  // because we are using node.wholeText to compile
  // all adjacent text nodes together. This fixes
  // issues in IE where sometimes it splits up a single
  // text node into multiple ones.
  var next = node.nextSibling
  while (next && next.nodeType === 3) {
    next._skip = true
    next = next.nextSibling
  }

  var frag = document.createDocumentFragment()
  var el, token
  for (var i = 0, l = tokens.length; i < l; i++) {
    token = tokens[i]
     // '{{a}} vue {{b}}'这样一段插值得到的token中
   // token[1]就是' vue ',tag为false,
   // 直接用' vue ' createTextNode即可
    el = token.tag
    ? processTextToken(token, options)
    : document.createTextNode(token.value)
    frag.appendChild(el)
  }
  return makeTextNodeLinkFn(tokens, frag, options)
}

/**
 * Linker for an skipped text node.
 *
 * @param {Vue} vm
 * @param {Text} node
 */

 function removeText (vm, node) {
  remove(node)
}

/**
 * Process a single text token.
 *
 * @param {Object} token
 * @param {Object} options
 * @return {Node}
 */

 function processTextToken (token, options) {
  var el
  if (token.oneTime) {
    el = document.createTextNode(token.value)
  } else {
     // 这个comment元素形成一个锚点的作用,告诉vue哪个地方应该插入v-html生成的内容
    if (token.html) {
      el = document.createComment('v-html')
      setTokenType('html')
    } else {
      // IE will clean up empty textNodes during
      // frag.cloneNode(true), so we have to give it
      // something here...
      el = document.createTextNode(' ')
      setTokenType('text')
    }
  }
  function setTokenType (type) {
    if (token.descriptor) return
      // parseDirective其实是解析出filters,
   // 比如 'msg | uppercase' 
   // 就会生成{expression:'msg',filters:[过滤器名称和参数]}
      var parsed = parseDirective(token.value)
    token.descriptor = {
      name: type,
      def: publicDirectives[type],
      expression: parsed.expression,
      filters: parsed.filters
    }
  }
  return el
}

/**
 * Build a function that processes a textNode.
 *
 * @param {Array<Object>} tokens
 * @param {DocumentFragment} frag
 */

 function makeTextNodeLinkFn (tokens, frag) {
  return function textNodeLinkFn (vm, el, host, scope) {
    var fragClone = frag.cloneNode(true)
    var childNodes = toArray(fragClone.childNodes)
    var token, value, node
    for (var i = 0, l = tokens.length; i < l; i++) {
      token = tokens[i]
      value = token.value
      if (token.tag) {
        node = childNodes[i]
        if (token.oneTime) {
          value = (scope || vm).$eval(value)
          if (token.html) {
            replace(node, parseTemplate(value, true))
          } else {
            node.data = _toString(value)
          }
        } else {
          vm._bindDir(token.descriptor, node, host, scope)
        }
      }
    }
    replace(el, fragClone)
  }
}

/**
 * Compile a node list and return a childLinkFn.

    compileNodeList其实是对应于多个元素情况下，对每个元素执行compileNode、
    对其childNodes递归执行compileNodeList，
    本质上就是遍历元素递归对每个元素执行compileNode。
 *
 * @param {NodeList} nodeList
 * @param {Object} options
 * @return {Function|undefined}
 */

 function compileNodeList (nodeList, options) {
  var linkFns = []
  var nodeLinkFn, childLinkFn, node
  for (var i = 0, l = nodeList.length; i < l; i++) {
    node = nodeList[i]
    nodeLinkFn = compileNode(node, options)
    childLinkFn =
    !(nodeLinkFn && nodeLinkFn.terminal) &&
    node.tagName !== 'SCRIPT' &&
    node.hasChildNodes()
    ? compileNodeList(node.childNodes, options) //递归编译
    : null
    linkFns.push(nodeLinkFn, childLinkFn)
  }
  return linkFns.length
  ? makeChildLinkFn(linkFns)
  : null
}

/**
 * Make a child link function for a node's childNodes.
 *
 * @param {Array<Function>} linkFns
 * @return {Function} childLinkFn
 */

 function makeChildLinkFn (linkFns) {
  return function childLinkFn (vm, nodes, host, scope, frag) {
    var node, nodeLinkFn, childrenLinkFn
    for (var i = 0, n = 0, l = linkFns.length; i < l; n++) {
      node = nodes[n]
      nodeLinkFn = linkFns[i++]
      childrenLinkFn = linkFns[i++]
      // cache childNodes before linking parent, fix #657
      var childNodes = toArray(node.childNodes)
      if (nodeLinkFn) {
        nodeLinkFn(vm, node, host, scope, frag)
      }
      if (childrenLinkFn) {
        childrenLinkFn(vm, childNodes, host, scope, frag)
      }
    }
  }
}

/**
 * Check for element directives (custom elements that should
 * be resovled as terminal directives).
 *
 * @param {Element} el
 * @param {Object} options
 */

 function checkElementDirectives (el, options) {
  var tag = el.tagName.toLowerCase()
  // commonTagRE: /^(div|p|span|img|a|b|i|br|ul|ol|li|h1|h2|h3|h4|h5|h6|code|pre|table|th|td|tr|form|label|input|select|option|nav|article|section|header|footer|main)$/i
  if (commonTagRE.test(tag)) {
    return
  }
  var def = resolveAsset(options, 'elementDirectives', tag)
  if (def) {
    return makeTerminalNodeLinkFn(el, tag, '', options, def)
  }
}

/**
 * Check if an element is a component. If yes, return
 * a component link function.
 *
 * @param {Element} el
 * @param {Object} options
 * @return {Function|undefined}
 */

 function checkComponent (el, options) {
  // 判断元素是否为一个组件
  var component = checkComponentAttr(el, options)
  if (component) {
    var ref = findRef(el)
    var descriptor = {
      name: 'component',
      ref: ref,
      expression: component.id,
      def: internalDirectives.component,
      modifiers: {
        literal: !component.dynamic
      }
    }
    var componentLinkFn = function (vm, el, host, scope, frag) {
      if (ref) {
        defineReactive((scope || vm).$refs, ref, null)
      }
      vm._bindDir(descriptor, el, host, scope, frag)
    }
    componentLinkFn.terminal = true
    return componentLinkFn
  }
}

/**
 * Check an element for terminal directives in fixed order.
 * If it finds one, return a terminal link function.
 *
 * @param {Element} el
 * @param {Array} attrs
 * @param {Object} options
 * @return {Function} terminalLinkFn
 */

 function checkTerminalDirectives (el, attrs, options) {
  // skip v-pre
  if (getAttr(el, 'v-pre') !== null) {
    return skip
  }
  // skip v-else block, but only if following v-if
  if (el.hasAttribute('v-else')) {
    var prev = el.previousElementSibling
    if (prev && prev.hasAttribute('v-if')) {
      return skip
    }
  }

  var attr, name, value, modifiers, matched, dirName, rawName, arg, def, termDef
  for (var i = 0, j = attrs.length; i < j; i++) {
    attr = attrs[i]
    // modifierRE: /\.[^\.]+/g
    // '@click.stop'.replace(modifierRE, '') => '@click'
    name = attr.name.replace(modifierRE, '')
    // dirAttrRE: /^v-([^:]+)(?:$|:(.*)$)/
    // 'v-bind:style'.match(/^v-([^:]+)(?:$|:(.*)$)/) => ['v-bind:style', 'bind', 'style']
    if ((matched = name.match(dirAttrRE))) {
      def = resolveAsset(options, 'directives', matched[1])
      if (def && def.terminal) {
        if (!termDef || ((def.priority || DEFAULT_TERMINAL_PRIORITY) > termDef.priority)) {
          termDef = def
          rawName = attr.name
          modifiers = parseModifiers(attr.name)
          value = attr.value
          dirName = matched[1]
          arg = matched[2]
        }
      }
    }
  }

  if (termDef) {
    // el: <h3 v-if="show">this is v-if</h3>
    // dirName: "if"
    // value: "show"
    // rawName 'v-if'
    return makeTerminalNodeLinkFn(el, dirName, value, options, termDef, rawName, arg, modifiers)
  }
}

function skip () {}
skip.terminal = true

/**
 * Build a node link function for a terminal directive.
 * A terminal link function terminates the current
 * compilation recursion and handles compilation of the
 * subtree in the directive.
 *
 * @param {Element} el
 * @param {String} dirName
 * @param {String} value
 * @param {Object} options
 * @param {Object} def
 * @param {String} [rawName]
 * @param {String} [arg]
 * @param {Object} [modifiers]
 * @return {Function} terminalLinkFn
 */

 function makeTerminalNodeLinkFn (el, dirName, value, options, def, rawName, arg, modifiers) {
  // {expression: "show"}
  var parsed = parseDirective(value)
  var descriptor = {
    name: dirName,
    arg: arg,
    expression: parsed.expression,
    filters: parsed.filters,
    raw: value,
    attr: rawName,
    modifiers: modifiers,
    def: def
  }
  // check ref for v-for, v-if and router-view
  if (dirName === 'for' || dirName === 'router-view') {
    //是否是v-ref
    descriptor.ref = findRef(el)
  }
  var fn = function terminalNodeLinkFn (vm, el, host, scope, frag) {
    if (descriptor.ref) {
      defineReactive((scope || vm).$refs, descriptor.ref, null)
    }
    vm._bindDir(descriptor, el, host, scope, frag)
  }
  fn.terminal = true
  return fn
}

/**
 * Compile the directives on an element and return a linker.
 *
 * @param {Array|NamedNodeMap} attrs
 * @param {Object} options
 * @return {Function}
 */

 function compileDirectives (attrs, options) {
  var i = attrs.length
  var dirs = []
  var attr, name, value, rawName, rawValue, dirName, arg, modifiers, dirDef, tokens, matched
    // console.log(attrs)
    while (i--) {
    // 属性节点
    attr = attrs[i]
    name = rawName = attr.name
    value = rawValue = attr.value
    // 对文本进行匹配，筛选包含"{{ }}", "{{{ }}}"字段，并进行缓存且返回数组
    tokens = parseText(value)
    // reset arg
    arg = null
    // check modifiers
    // 处理属性名中有修饰符的属性，如“@click.stop”
    modifiers = parseModifiers(name)

    // modifierRE: /\.[^\.]+/g, 去除属性中修饰符相关 如"@click.stop" => "@click"
    name = name.replace(modifierRE, '')

    // attribute interpolations
    // 是否为绑定数据"{{ }}" 或 "{{{ }}}"
    if (tokens) {
      value = tokensToExp(tokens)
      arg = name
      pushDir('bind', publicDirectives.bind, tokens)
      // warn against mixing mustaches with v-bind
      if (process.env.NODE_ENV !== 'production') {
        if (name === 'class' && Array.prototype.some.call(attrs, function (attr) {
          return attr.name === ':class' || attr.name === 'v-bind:class'
        })) {
          warn(
            'class="' + rawValue + '": Do not mix mustache interpolation ' +
            'and v-bind for "class" on the same element. Use one or the other.',
            options
            )
        }
      }
    } else

    // special attribute: transition
    // transitionRE: /^(v-bind:|:)?transition$/
    // 属性名中是否有 transition 属性
    // transitionRE.test('v-bind:transition') => true
    // bindRE: /^v-bind:|^:/
    if (transitionRE.test(name)) {
      modifiers.literal = !bindRE.test(name) //判断是否有使用v-bind 或 “:” 方式的属性，如":style"、":class"
      pushDir('transition', internalDirectives.transition)
    } else

    // event handlers
    // onRE: /^v-on:|^@/ 是否为事件相关属性，如“v-on:click”、"@click"
    if (onRE.test(name)) {
      arg = name.replace(onRE, '')
      pushDir('on', publicDirectives.on)
    } else

    // attribute bindings
    // bindRE: /^v-bind:|^:/ 是否为bind相关属性，如"v-bind:style"、":style"
    if (bindRE.test(name)) {
      dirName = name.replace(bindRE, '')
      if (dirName === 'style' || dirName === 'class') {
        pushDir(dirName, internalDirectives[dirName])
      } else {
        arg = dirName
        pushDir('bind', publicDirectives.bind)
      }
    } else

    // normal directives
    // dirAttrRE: /^v-([^:]+)(?:$|:(.*)$)/ 是否为其他自定义指令
    if ((matched = name.match(dirAttrRE))) {
      dirName = matched[1]
      arg = matched[2]

      // skip v-else (when used with v-show)
      if (dirName === 'else') {
        continue
      }

      dirDef = resolveAsset(options, 'directives', dirName, true)
      if (dirDef) {
        pushDir(dirName, dirDef)
      }
    }
    // console.log(dirs)
  }

  /**
   * Push a directive.
   *
   * @param {String} dirName
   * @param {Object|Function} def
   * @param {Array} [interpTokens]
   */

   function pushDir (dirName, def, interpTokens) {
    var hasOneTimeToken = interpTokens && hasOneTime(interpTokens)
    var parsed = !hasOneTimeToken && parseDirective(value)
    /**
    指令描述对象，以v-bind:href.literal="mylink"为例:
      {
        arg:"href",
        attr:"v-bind:href.literal",
        def:Object,// v-bind指令的定义
        expression:"mylink", // 表达式，如果是插值的话，那主要用到的是下面的interp字段
        filters:undefined
        hasOneTime:undefined
        interp:undefined,// 存放插值token
        modifiers:Object, // literal修饰符的定义
        name:"bind" //指令类型
        raw:"mylink"  //未处理前的原始属性值
      }

    **/
    dirs.push({
      name: dirName,
      attr: rawName,
      raw: rawValue,
      def: def,
      arg: arg,
      modifiers: modifiers,
      // conversion from interpolation strings with one-time token
      // to expression is differed until directive bind time so that we
      // have access to the actual vm context for one-time bindings.
      expression: parsed && parsed.expression,
      filters: parsed && parsed.filters,
      interp: interpTokens,
      hasOneTime: hasOneTimeToken
    })
  }
  if (dirs.length) {
    return makeNodeLinkFn(dirs)
  }
}

/**
 * Parse modifiers from directive attribute name.
 * 匹配属性中包含“.”，如“@click.stop”
 *
 * @param {String} name
 * @return {Object}
 */

 function parseModifiers (name) {
  var res = Object.create(null)
  // modifierRE: /\.[^\.]+/g
  // '@click.stop'.match(modifierRE) => ['.stop']
  var match = name.match(modifierRE)
  if (match) {
    var i = match.length
    while (i--) {
      // "stop": true
      res[match[i].slice(1)] = true
    }
  }
  return res
}

/**
 * Build a link function for all directives on a single node.
 *
 * @param {Array} directives
 * @return {Function} directivesLinkFn
 */

 function makeNodeLinkFn (directives) {
  return function nodeLinkFn (vm, el, host, scope, frag) {
    // reverse apply because it's sorted low to high
    var i = directives.length
    while (i--) {
      vm._bindDir(directives[i], el, host, scope, frag)
    }
  }
}

/**
 * Check if an interpolation string contains one-time tokens.
 *
 * @param {Array} tokens
 * @return {Boolean}
 */

 function hasOneTime (tokens) {
  var i = tokens.length
  while (i--) {
    if (tokens[i].oneTime) return true
  }
}

function isScript (el) {
  return el.tagName === 'SCRIPT' && (
    !el.hasAttribute('type') ||
    el.getAttribute('type') === 'text/javascript'
    )
}
