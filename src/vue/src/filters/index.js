import { toArray, debounce as _debounce } from '../util/index'
import { orderBy, filterBy, limitBy } from './array-filters'
const digitsRE = /(\d{3})(?=\d)/g

// asset collections must be a plain object.
export default {

  orderBy,
  filterBy,
  limitBy,

  /**
   * Stringify value.
   *
   * @param {Number} indent
   */

  json: {
    read: function (value, indent) {
      return typeof value === 'string'
        ? value
        : JSON.stringify(value, null, arguments.length > 1 ? indent : 2)
    },
    write: function (value) {
      try {
        return JSON.parse(value)
      } catch (e) {
        return value
      }
    }
  },

  /**
   * 'abc' => 'Abc'
   */

  capitalize (value) {
    if (!value && value !== 0) return ''
    value = value.toString()
    return value.charAt(0).toUpperCase() + value.slice(1)
  },

  /**
   * 'abc' => 'ABC'
   */

  uppercase (value) {
    return (value || value === 0)
      ? value.toString().toUpperCase()
      : ''
  },

  /**
   * 'AbC' => 'abc'
   */

  lowercase (value) {
    return (value || value === 0)
      ? value.toString().toLowerCase()
      : ''
  },

  /**
   * 12345 => $12,345.00
   *
   * @param {String} sign
   * @param {Number} decimals Decimal places
   */

  currency (value, currency, decimals) {
    value = parseFloat(value)
    if (!isFinite(value) || (!value && value !== 0)) return ''
    currency = currency != null ? currency : '$'
    decimals = decimals != null ? decimals : 2
    // Math.abs: 返回数的绝对值
    var stringified = Math.abs(value).toFixed(decimals) // '12345' => '12345.00'

    // _int = '12345.00'.slice(0, -3) => 12345
    var _int = decimals
      ? stringified.slice(0, -1 - decimals)
      : stringified

    // i = 2  
    var i = _int.length % 3

    // 将最前面的部分截取出来，如12345 => 12,345 最前面为12； 1234 => 1,234 最前面部分为1；
    var head = i > 0
      ? (_int.slice(0, i) + (_int.length > 3 ? ',' : ''))
      : ''

    // 截取包括小数点及小数点后面两位，12345.00 => _float = .00  
    var _float = decimals
      ? stringified.slice(-1 - decimals)
      : ''

    // 判断为负数还是正数  
    var sign = value < 0 ? '-' : ''

    /**
    * digitsRE: /(\d{3})(?=\d)/g 将去除head及小数部分的值用正则进行每三位用逗号(,)分割
    * '123456789'.match(/(\d{3})(?=\d)/g) => ['123', '456']
    * /(\d{3})(?=\d)/g: (\d{3}) 匹配三个数字； (?=\d) 匹配一个数字，(?=)但是不保存获取的值供后续使用
    * ?=, ?: 相关正则，见https://www.cnblogs.com/whaozl/p/5462865.html
    *
    * 最后：sign(正负标记) + currency(货币单位) + head(头部位数字) + 加逗号中间位 ＋ _float(小数点及小数位)
    **/
    return sign + currency + head +
      _int.slice(i).replace(digitsRE, '$1,') +
      _float
  },

  /**
   * 'item' => 'items'
   *
   * @params
   *  an array of strings corresponding to
   *  the single, double, triple ... forms of the word to
   *  be pluralized. When the number to be pluralized
   *  exceeds the length of the args, it will use the last
   *  entry in the array.
   *
   *  e.g. ['single', 'double', 'triple', 'multiple']
   */

  pluralize (value) {
    var args = toArray(arguments, 1)
    var length = args.length
    if (length > 1) {
      var index = value % 10 - 1
      return index in args ? args[index] : args[length - 1]
    } else {
      return args[0] + (value === 1 ? '' : 's')
    }
  },

  /**
   * Debounce a handler function.
   *
   * @param {Function} handler
   * @param {Number} delay = 300
   * @return {Function}
   */

  debounce (handler, delay) {
    if (!handler) return
    if (!delay) {
      delay = 300
    }
    return _debounce(handler, delay)
  }
}
