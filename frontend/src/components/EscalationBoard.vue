<template>
  <div class="bg-gray-900 rounded-xl p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h3 class="text-sm text-orange-400 font-bold">告警升级看板</h3>
      <div class="flex gap-2">
        <span class="text-xs bg-red-900/60 text-red-300 px-2 py-0.5 rounded">
          已升级 {{ escalatedAlarms.length }}
        </span>
        <span class="text-xs bg-yellow-900/60 text-yellow-300 px-2 py-0.5 rounded">
          待确认 {{ unacknowledgedAlarms.length }}
        </span>
      </div>
    </div>

    <div v-if="escalatedAlarms.length === 0 && unacknowledgedAlarms.length === 0"
      class="text-center text-gray-600 text-xs py-6">
      暂无告警升级记录
    </div>

    <div v-else class="flex flex-col gap-2 max-h-80 overflow-y-auto">
      <div v-for="alarm in sortedAlarms" :key="alarm.id"
        class="bg-gray-800 rounded-lg p-3 border-l-4 transition-all"
        :class="escalationBorderColor(alarm)">
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-bold px-1.5 py-0.5 rounded"
                :class="levelBadgeClass(alarm.level)">
                {{ levelLabel(alarm.level) }}
              </span>
              <span v-if="alarm.escalationLevel > 0"
                class="text-xs font-bold px-1.5 py-0.5 rounded bg-orange-700 text-orange-100">
                升级 Lv.{{ alarm.escalationLevel }}
              </span>
              <span class="text-xs text-gray-400 truncate">{{ alarm.message }}</span>
            </div>
            <div class="flex items-center gap-3 text-xs text-gray-500 mt-1">
              <span>{{ formatTime(alarm.timestamp) }}</span>
              <span v-if="alarm.escalatedAt" class="text-orange-400">
                升级于 {{ formatTime(alarm.escalatedAt) }}
              </span>
            </div>
          </div>
          <button v-if="!alarm.acknowledged"
            @click="store.acknowledgeAlarm(alarm.id)"
            class="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded ml-2 whitespace-nowrap">
            确认
          </button>
          <span v-else class="text-xs text-green-500 ml-2">已确认</span>
        </div>

        <div v-if="alarm.escalationLevel > 0"
          class="mt-2 bg-gray-900/60 rounded p-2">
          <div class="flex items-center gap-2 text-xs mb-1.5">
            <span class="text-gray-400">当前责任归属:</span>
            <span class="text-orange-300 font-bold">{{ alarm.responsiblePerson }}</span>
            <span class="text-gray-500">({{ alarm.responsibleRole }})</span>
          </div>
          <div v-if="countdownText(alarm)" class="text-xs text-yellow-500 mb-1">
            ⏱ {{ countdownText(alarm) }}
          </div>
        </div>

        <div v-if="alarm.escalationHistory.length > 0" class="mt-2">
          <button @click="toggleHistory(alarm.id)"
            class="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
            <svg class="w-3 h-3 transition-transform"
              :class="expandedAlarms.has(alarm.id) ? 'rotate-90' : ''"
              fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 6L14 10L6 14V6Z"/>
            </svg>
            升级轨迹 ({{ alarm.escalationHistory.length }})
          </button>
          <div v-if="expandedAlarms.has(alarm.id)" class="mt-1.5 ml-3 border-l-2 border-gray-700 pl-3">
            <div v-for="(rec, i) in alarm.escalationHistory" :key="i" class="text-xs mb-1.5 last:mb-0">
              <div class="flex items-center gap-2">
                <span class="text-gray-500">{{ formatTime(rec.timestamp) }}</span>
                <span :class="levelTextColor(rec.fromLevel)">{{ levelLabel(rec.fromLevel) }}</span>
                <span class="text-gray-600">→</span>
                <span :class="levelTextColor(rec.toLevel)">{{ levelLabel(rec.toLevel) }}</span>
                <span class="text-orange-400">Lv.{{ rec.escalationLevel }}</span>
              </div>
              <div class="text-gray-400 mt-0.5">
                → {{ rec.responsiblePerson }} ({{ rec.responsibleRole }})
              </div>
              <div class="text-gray-600 mt-0.5">{{ rec.reason }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="responsibilitySummary.length > 0"
      class="border-t border-gray-800 pt-3">
      <h4 class="text-xs text-gray-400 mb-2">责任归属统计</h4>
      <div class="grid grid-cols-4 gap-2">
        <div v-for="s in responsibilitySummary" :key="s.role"
          class="bg-gray-800 rounded p-2 text-center">
          <div class="text-lg font-bold" :class="s.count > 0 ? 'text-orange-400' : 'text-gray-600'">
            {{ s.count }}
          </div>
          <div class="text-xs text-gray-500">{{ s.role }}</div>
          <div class="text-xs text-gray-600">{{ s.person }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useModbusStore } from '../store/modbus'
import type { Alarm } from '../types'

const store = useModbusStore()
const expandedAlarms = ref<Set<string>>(new Set())
const now = ref(Date.now())
let tickTimer: number | null = null

onMounted(() => {
  tickTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
})

const escalatedAlarms = computed(() => store.escalatedAlarms)
const unacknowledgedAlarms = computed(() => store.unacknowledgedAlarms)

const sortedAlarms = computed(() => {
  return [...store.alarms]
    .filter(a => !a.acknowledged)
    .sort((a, b) => {
      if (a.escalationLevel !== b.escalationLevel) return b.escalationLevel - a.escalationLevel
      const levelWeight = { critical: 3, warning: 2, info: 1 }
      return (levelWeight[b.level] ?? 0) - (levelWeight[a.level] ?? 0)
    })
    .slice(0, 20)
})

const responsibilitySummary = computed(() => {
  const map = new Map<string, { person: string; role: string; count: number }>()
  for (const a of store.alarms) {
    if (a.acknowledged) continue
    const key = a.responsibleRole
    if (!map.has(key)) map.set(key, { person: a.responsiblePerson, role: a.responsibleRole, count: 0 })
    map.get(key)!.count++
  }
  return [
    { person: '值班操作员', role: '一线运维', count: 0 },
    { person: '运维主管', role: '二线主管', count: 0 },
    { person: '生产厂长', role: '三线决策', count: 0 },
    { person: '公司高管', role: '最高决策', count: 0 },
  ].map(item => {
    const found = map.get(item.role)
    return found ? { ...found } : item
  })
})

function toggleHistory(id: string) {
  if (expandedAlarms.value.has(id)) {
    expandedAlarms.value.delete(id)
  } else {
    expandedAlarms.value.add(id)
  }
}

function countdownText(alarm: Alarm): string {
  if (alarm.acknowledged || alarm.escalationLevel >= 3) return ''
  const timeouts: Record<number, number> = { 0: 30_000, 1: 60_000, 2: 120_000 }
  const timeout = timeouts[alarm.escalationLevel] ?? 60_000
  const elapsed = now.value - (alarm.escalatedAt ?? alarm.timestamp)
  const remaining = timeout - elapsed
  if (remaining <= 0) return '即将升级...'
  const seconds = Math.ceil(remaining / 1000)
  return `${seconds}s 后自动升级至 Lv.${alarm.escalationLevel + 1}`
}

function escalationBorderColor(alarm: Alarm): string {
  if (alarm.escalationLevel >= 3) return 'border-red-500'
  if (alarm.escalationLevel === 2) return 'border-orange-500'
  if (alarm.escalationLevel === 1) return 'border-yellow-500'
  if (alarm.level === 'critical') return 'border-red-500'
  if (alarm.level === 'warning') return 'border-yellow-500'
  return 'border-blue-500'
}

function levelBadgeClass(level: Alarm['level']): string {
  switch (level) {
    case 'critical': return 'bg-red-700 text-red-100'
    case 'warning': return 'bg-yellow-700 text-yellow-100'
    default: return 'bg-blue-700 text-blue-100'
  }
}

function levelLabel(level: Alarm['level']): string {
  switch (level) {
    case 'critical': return '严重'
    case 'warning': return '警告'
    default: return '信息'
  }
}

function levelTextColor(level: Alarm['level']): string {
  switch (level) {
    case 'critical': return 'text-red-400'
    case 'warning': return 'text-yellow-400'
    default: return 'text-blue-400'
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}
</script>
