import {
  extend,
  bind,
  on,
  off,
  getAttr,
  getBindAttr,
  camelize,
  hyphenate,
  nextTick,
  warn
} from './util/index'
import Watcher from './watcher'
import { parseExpression, isSimplePath } from './parsers/expression'

function noop () {}

/**
 * A directive links a DOM element with a piece of data,
 * which is the result of evaluating an expression.
 * It registers a watcher with the expression and calls
 * the DOM update function when a change is triggered.
 *
 * @param {Object} descriptor
 *                 - {String} name
 *                 - {Object} def
 *                 - {String} expression
 *                 - {Array<Object>} [filters]
 *                 - {Object} [modifiers]
 *                 - {Boolean} literal
 *                 - {String} attr
 *                 - {String} arg
 *                 - {String} raw
 *                 - {String} [ref]
 *                 - {Array<Object>} [interp]
 *                 - {Boolean} [hasOneTime]
 * @param {Vue} vm
 * @param {Node} el
 * @param {Vue} [host] - transclusion host component
 * @param {Object} [scope] - v-for scope
 * @param {Fragment} [frag] - owner fragment
 * @constructor
 */

 // 很多都是通过指令完成，如组件构建，文本绑定，循环，展示隐藏等

// 指令directive构造函数
// .literal 修饰符告诉指令将它的值解析为一个字面字符串而不是一个表达式
export default function Directive (descriptor, vm, el, host, scope, frag) {
  this.vm = vm
  this.el = el
  // copy descriptor properties
  this.descriptor = descriptor
  this.name = descriptor.name
  this.expression = descriptor.expression
  this.arg = descriptor.arg
  this.modifiers = descriptor.modifiers
  this.filters = descriptor.filters
  this.literal = this.modifiers && this.modifiers.literal
  // private
  this._locked = false
  this._bound = false
  this._listeners = null
  // link context
  this._host = host
  this._scope = scope
  this._frag = frag
  // store directives on node in dev mode
  if (process.env.NODE_ENV !== 'production' && this.el) {
    this.el._vue_directives = this.el._vue_directives || []
    this.el._vue_directives.push(this)
  }
}

/**
 * Initialize the directive, mixin definition properties,
 * setup the watcher, call definition bind() and update()
 * if present.
 */

Directive.prototype._bind = function () {
  var name = this.name
  var descriptor = this.descriptor


  // remove attribute
  if (
    // 只要不是cloak指令那就从dom的attribute里移除
    // 是cloak指令但是已经编译和link完成了的话,那也还是可以移除的
    // 如移出":class"、":style"等
    (name !== 'cloak' || this.vm._isCompiled) &&
    this.el && this.el.removeAttribute
  ) {
    var attr = descriptor.attr || ('v-' + name)
    this.el.removeAttribute(attr)
  }

  // copy def properties
  // 不采用原型链继承,而是直接extend定义对象到this上，来扩展Directive实例
  // 将不同指令一些特殊的函数或熟悉合并到实例化的directive里
  var def = descriptor.def
  if (typeof def === 'function') {
    this.update = def
  } else {
    extend(this, def)
  }

  // setup directive params
  // 获取指令的参数, 对于一些指令, 指令的元素上可能存在其他的attr来作为指令运行的参数
  // 比如v-for指令,那么元素上的attr: track-by="..." 就是参数
  // 比如组件指令,那么元素上可能写了transition-mode="out-in", 诸如此类
  this._setupParams()

  // initial bind
  if (this.bind) {
    this.bind()
  }
  this._bound = true
  // 下面这些判断是因为许多指令比如slot component之类的并不是响应式的,
  // 他们只需要在bind里处理好dom的分发和编译/link即可然后他们的使命就结束了,生成watcher和收集依赖等步骤根本没有
  // 所以根本不用执行下面的处理
  if (this.literal) {
    this.update && this.update(descriptor.raw)
  } else if (
    (this.expression || this.modifiers) &&
    (this.update || this.twoWay) &&
    !this._checkStatement()
  ) {
    // wrapped updater for context
    var dir = this
    if (this.update) {
      // 处理一下原本的update函数,加入lock判断
      this._update = function (val, oldVal) {
        if (!dir._locked) {
          dir.update(val, oldVal)
        }
      }
    } else {
      this._update = noop
    }
    // 绑定好 预处理 和 后处理 函数的this,因为他们即将作为属性放入一个参数对象当中,不绑定的话this会变
    var preProcess = this._preProcess
      ? bind(this._preProcess, this)
      : null
    var postProcess = this._postProcess
      ? bind(this._postProcess, this)
      : null
    var watcher = this._watcher = new Watcher(
      this.vm,
      this.expression,
      this._update, // callback
      {
        filters: this.filters,
        twoWay: this.twoWay,
        deep: this.deep,
        preProcess: preProcess,
        postProcess: postProcess,
        scope: this._scope
      }
    )
    // v-model with inital inline value need to sync back to
    // model instead of update to DOM on init. They would
    // set the afterBind hook to indicate that.
    if (this.afterBind) {
      this.afterBind()
    } else if (this.update) {
      this.update(watcher.value)
    }
  }
}

/**
 * Setup all param attributes, e.g. track-by,
 * transition-mode, etc...
 */

Directive.prototype._setupParams = function () {
  // this.params数据来源于指令 descriptor 合并到 this 中 
  if (!this.params) {
    return
  }
  var params = this.params
  // swap the params array with a fresh object.
  this.params = Object.create(null)
  var i = params.length
  var key, val, mappedKey
  while (i--) {
    // 使用－连接驼峰字符串，如toDetail => to-detail
    key = hyphenate(params[i])
    //驼峰化一个连字符连接的字符串
    mappedKey = camelize(key)
    val = getBindAttr(this.el, key)
    if (val != null) {
      // dynamic
      this._setupParamWatcher(mappedKey, val)
    } else {
      // static
      val = getAttr(this.el, key)
      if (val != null) {
        this.params[mappedKey] = val === '' ? true : val
      }
    }
  }
}

/**
 * Setup a watcher for a dynamic param.
 *
 * @param {String} key
 * @param {String} expression
 */

Directive.prototype._setupParamWatcher = function (key, expression) {
  var self = this
  var called = false
  var unwatch = (this._scope || this.vm).$watch(expression, function (val, oldVal) {
    self.params[key] = val
    // since we are in immediate mode,
    // only call the param change callbacks if this is not the first update.
    if (called) {
      var cb = self.paramWatchers && self.paramWatchers[key]
      if (cb) {
        cb.call(self, val, oldVal)
      }
    } else {
      called = true
    }
  }, {
    immediate: true,
    user: false
  })
  ;(this._paramUnwatchFns || (this._paramUnwatchFns = [])).push(unwatch)
}

/**
 * Check if the directive is a function caller
 * and if the expression is a callable one. If both true,
 * we wrap up the expression and use it as the event
 * handler.
 *
 * e.g. on-click="a++"
 *
 * @return {Boolean}
 */

Directive.prototype._checkStatement = function () {
  var expression = this.expression
  if (
    expression && this.acceptStatement &&
    !isSimplePath(expression)
  ) {
    var fn = parseExpression(expression).get
    var scope = this._scope || this.vm
    var handler = function (e) {
      scope.$event = e
      fn.call(scope, scope)
      scope.$event = null
    }
    if (this.filters) {
      handler = scope._applyFilters(handler, null, this.filters)
    }
    this.update(handler)
    return true
  }
}

/**
 * Set the corresponding value with the setter.
 * This should only be used in two-way directives
 * e.g. v-model.
 *
 * @param {*} value
 * @public
 */

Directive.prototype.set = function (value) {
  /* istanbul ignore else */
  if (this.twoWay) {
    this._withLock(function () {
      this._watcher.set(value)
    })
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      'Directive.set() can only be used inside twoWay' +
      'directives.'
    )
  }
}

/**
 * Execute a function while preventing that function from
 * triggering updates on this directive instance.
 *
 * @param {Function} fn
 */

Directive.prototype._withLock = function (fn) {
  var self = this
  self._locked = true
  fn.call(self)
  nextTick(function () {
    self._locked = false
  })
}

/**
 * Convenience method that attaches a DOM event listener
 * to the directive element and autometically tears it down
 * during unbind.
 *
 * @param {String} event
 * @param {Function} handler
 * @param {Boolean} [useCapture]
 */

Directive.prototype.on = function (event, handler, useCapture) {
  on(this.el, event, handler, useCapture)
  ;(this._listeners || (this._listeners = []))
    .push([event, handler])
}

/**
 * Teardown the watcher and call unbind.
 */

Directive.prototype._teardown = function () {
  if (this._bound) {
    this._bound = false
    if (this.unbind) {
      this.unbind()
    }
    if (this._watcher) {
      this._watcher.teardown()
    }
    var listeners = this._listeners
    var i
    if (listeners) {
      i = listeners.length
      while (i--) {
        off(this.el, listeners[i][0], listeners[i][1])
      }
    }
    var unwatchFns = this._paramUnwatchFns
    if (unwatchFns) {
      i = unwatchFns.length
      while (i--) {
        unwatchFns[i]()
      }
    }
    if (process.env.NODE_ENV !== 'production' && this.el) {
      this.el._vue_directives.$remove(this)
    }
    this.vm = this.el = this._watcher = this._listeners = null
  }
}
