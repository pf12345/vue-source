<template>
  <div class="hello">
    <h1>hello {{ msg }} welcome here</h1>
    <h3 v-if="show" >this is v-if</h3>
  </div>
</template>

<script>
import test from './test.vue'
export default {
  components: {
    test
  },
  created() {
    
  },
  data () {
    return {
      msg: 'Hello World!',
      show: false
    }
  },
  mounted() {
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
h1 {
  color: #42b983;
}
</style>
