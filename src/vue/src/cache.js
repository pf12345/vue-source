/**
 * A doubly linked list-based Least Recently Used (LRU)
 * cache. Will keep most recently used items while
 * discarding least recently used items when its limit is
 * reached. This is a bare-bone version of
 * Rasmus Andersson's js-lru:
 *
 *   https://github.com/rsms/js-lru
 *
 * @param {Number} limit
 * @constructor
 */

export default function Cache (limit) {
  this.size = 0
  this.limit = limit
  //head代表第一个，tail代表最后一个
  //一个entry可能会有一个newer entry以及一个older entry（双向链接，older entry更接近head，newer entry更接近tail）
  this.head = this.tail = undefined
  this._keymap = Object.create(null) //默认缓存保存位置
}

var p = Cache.prototype

/**
 * Put <value> into the cache associated with <key>.
 * Returns the entry which was removed to make room for
 * the new entry. Otherwise undefined is returned.
 * (i.e. if there was enough room already).
 *
 * @param {String} key
 * @param {*} value
 * @return {Entry|undefined}
 */

 // 在缓存中加入一个key-value对象，如果缓存数组已经达到最大值，则返回被删除的entry，即head,否则返回undefined
p.put = function (key, value) {
  var removed

  // 查找缓存是否已经有此数据
  var entry = this.get(key, true)

  // 如果缓存中没有此数据
  if (!entry) {
    // 如果已经达到了缓存存储最大值
    if (this.size === this.limit) {
      // 移出缓存第一个, 也是最存在最久那个缓存
      removed = this.shift()
    }
    // 初始化新的缓存对象
    entry = {
      key: key
    }
    this._keymap[key] = entry

    //如果以前已经有尾部，以前尾部块因为变成倒数第二个，所以需要改变其指向，将其newer指向新的缓存块，即最后一个；
    // 而新块，即倒数最后一个，其older必须指向以前的this.tail
    // 此时，this.tail还仍然是以前最后一块，即最终的倒数第二块
    if (this.tail) {
      this.tail.newer = entry
      entry.older = this.tail
    } else {
      this.head = entry
    }
    // 将this.tail重新指向新的缓存块；
    this.tail = entry
    //因为添加了一个新的块，所以size增加1
    //如果存储满了，会按上面走this.shift()，并将其size减去1，所以最终任何情况，在这都需要加1；
    this.size++
  }
  entry.value = value

  return removed
}

/**
 * Purge the least recently used (oldest) entry from the
 * cache. Returns the removed entry or undefined if the
 * cache was empty.
 */

//移出最旧那个缓存块
// 在缓存数组中移除最少使用的entry，即head，返回被删除的entry。如果缓存数组为空，则返回undefined
p.shift = function () {
  //取出指向第一个的块
  var entry = this.head

  //如果有，对指向进行重新处理，将以前指向块的后面一块，也就是以前this.head中的newer指向的块赋给this.head作为第一块
  // 因为以前第二块移动到第一块，所以它将没有指向前面的块，则将其older置为空；
  // 并将取出的块的指向都置为空，并将缓存整个长度减去1
  if (entry) {
    this.head = this.head.newer
    this.head.older = undefined
    entry.newer = entry.older = undefined
    this._keymap[entry.key] = undefined
    this.size--
  }
  return entry
}

/**
 * Get and register recent use of <key>. Returns the value
 * associated with <key> or undefined if not in cache.
 *
 * @param {String} key
 * @param {Boolean} returnEntry
 * @return {Entry|*}
 */

// 获取某个缓存数据
// 将key为传入参数的缓存对象标识为最常使用的entry，即tail，并调整双向链表，返回改变后的tail。如果不存在key为传入参数的缓存对象，则返回undefined
p.get = function (key, returnEntry) {
  var entry = this._keymap[key]
  if (entry === undefined) return
  if (entry === this.tail) {
    return returnEntry
      ? entry
      : entry.value
  }
  // HEAD--------------TAIL
  //   <.older   .newer>
  //  <--- add direction --
  //   A  B  C  <D>  E
  if (entry.newer) {
    if (entry === this.head) {
      this.head = entry.newer
    }
    entry.newer.older = entry.older // C <-- E.
  }
  if (entry.older) {
    entry.older.newer = entry.newer // C. --> E
  }
  entry.newer = undefined // D --x
  entry.older = this.tail // D. --> E
  if (this.tail) {
    this.tail.newer = entry // E. <-- D
  }
  this.tail = entry
  return returnEntry
    ? entry
    : entry.value
}
