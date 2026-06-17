import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { Device, Alarm, EscalationRecord } from '../types'

const ESCALATION_TIMEOUTS: Record<number, number> = {
  0: 30_000,
  1: 60_000,
  2: 120_000,
}

const LEVEL_ORDER: Alarm['level'][] = ['info', 'warning', 'critical']

const RESPONSIBILITY_CHAIN: Record<number, { person: string; role: string }> = {
  0: { person: '值班操作员', role: '一线运维' },
  1: { person: '运维主管', role: '二线主管' },
  2: { person: '生产厂长', role: '三线决策' },
  3: { person: '公司高管', role: '最高决策' },
}

function nextLevel(current: Alarm['level']): Alarm['level'] | null {
  const idx = LEVEL_ORDER.indexOf(current)
  return idx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[idx + 1] : null
}

export const useModbusStore = defineStore('modbus', () => {
  const devices = ref<Device[]>([])
  const alarms = ref<Alarm[]>([])
  const historyData = ref<Record<string, { time: number[]; values: number[] }>>({})
  const isPolling = ref(false)
  const pollInterval = ref(1000)
  const selectedDevice = ref<Device | null>(null)
  const escalationCheckInterval = ref<number | null>(null)

  const criticalAlarms = computed(() => alarms.value.filter(a => a.level === 'critical' && !a.acknowledged))
  const onlineDevices = computed(() => devices.value.filter(d => d.online))
  const escalatedAlarms = computed(() => alarms.value.filter(a => a.escalationLevel > 0 && !a.acknowledged))
  const unacknowledgedAlarms = computed(() => alarms.value.filter(a => !a.acknowledged))

  function createAlarm(
    deviceId: string, register: string, message: string, level: Alarm['level']
  ): Alarm {
    const chain = RESPONSIBILITY_CHAIN[0]
    return {
      id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      deviceId, register, message, level,
      timestamp: Date.now(),
      acknowledged: false,
      escalationLevel: 0,
      escalatedAt: null,
      responsiblePerson: chain.person,
      responsibleRole: chain.role,
      escalationHistory: [],
    }
  }

  function escalateAlarm(alarm: Alarm): boolean {
    if (alarm.acknowledged) return false
    const next = nextLevel(alarm.level)
    if (next === null && alarm.escalationLevel >= 3) return false

    const fromLevel = alarm.level
    const newEscLevel = alarm.escalationLevel + 1
    const chain = RESPONSIBILITY_CHAIN[Math.min(newEscLevel, 3)] || RESPONSIBILITY_CHAIN[3]

    const record: EscalationRecord = {
      fromLevel,
      toLevel: next || alarm.level,
      escalationLevel: newEscLevel,
      timestamp: Date.now(),
      responsiblePerson: chain.person,
      responsibleRole: chain.role,
      reason: `告警超时 ${ESCALATION_TIMEOUTS[alarm.escalationLevel] / 1000}s 未确认，自动升级至第${newEscLevel}级`,
    }

    alarm.escalationLevel = newEscLevel
    alarm.escalatedAt = Date.now()
    alarm.responsiblePerson = chain.person
    alarm.responsibleRole = chain.role
    alarm.escalationHistory.push(record)

    if (next) alarm.level = next

    return true
  }

  function checkEscalations() {
    const now = Date.now()
    for (const alarm of alarms.value) {
      if (alarm.acknowledged) continue
      if (alarm.escalationLevel >= 3) continue
      const timeout = ESCALATION_TIMEOUTS[alarm.escalationLevel] ?? 60_000
      const elapsed = now - (alarm.escalatedAt ?? alarm.timestamp)
      if (elapsed >= timeout) {
        escalateAlarm(alarm)
      }
    }
  }

  function startEscalationChecker() {
    if (escalationCheckInterval.value) return
    escalationCheckInterval.value = window.setInterval(() => checkEscalations(), 5000)
  }

  function stopEscalationChecker() {
    if (escalationCheckInterval.value) {
      clearInterval(escalationCheckInterval.value)
      escalationCheckInterval.value = null
    }
  }

  function initMockDevices() {
    devices.value = [
      {
        id: 'dev1', name: '温湿度传感器-A区', ip: '192.168.1.101', port: 502, slaveId: 1, online: true,
        registers: [
          { address: 0, name: '温度', type: 'holding', value: 25.6, unit: '°C', updatedAt: Date.now() },
          { address: 1, name: '湿度', type: 'holding', value: 62.3, unit: '%RH', updatedAt: Date.now() },
          { address: 2, name: '露点', type: 'holding', value: 17.8, unit: '°C', updatedAt: Date.now() },
        ]
      },
      {
        id: 'dev2', name: '压力变送器-B区', ip: '192.168.1.102', port: 502, slaveId: 2, online: true,
        registers: [
          { address: 0, name: '管道压力', type: 'holding', value: 3.45, unit: 'MPa', updatedAt: Date.now() },
          { address: 1, name: '差压', type: 'holding', value: 0.12, unit: 'kPa', updatedAt: Date.now() },
        ]
      },
      {
        id: 'dev3', name: '电机控制器-C区', ip: '192.168.1.103', port: 502, slaveId: 3, online: false,
        registers: [
          { address: 0, name: '转速', type: 'holding', value: 1480, unit: 'RPM', updatedAt: Date.now() },
          { address: 1, name: '电流', type: 'holding', value: 12.5, unit: 'A', updatedAt: Date.now() },
          { address: 2, name: '运行状态', type: 'coil', value: true, unit: '', updatedAt: Date.now() },
        ]
      },
      {
        id: 'dev4', name: '流量计-D区', ip: '192.168.1.104', port: 502, slaveId: 4, online: true,
        registers: [
          { address: 0, name: '瞬时流量', type: 'holding', value: 156.7, unit: 'L/min', updatedAt: Date.now() },
          { address: 1, name: '累计流量', type: 'holding', value: 98234, unit: 'L', updatedAt: Date.now() },
        ]
      },
    ]
    selectedDevice.value = devices.value[0]
    startEscalationChecker()
  }

  function simulatePoll() {
    for (const dev of devices.value) {
      if (!dev.online) continue
      for (const reg of dev.registers) {
        if (typeof reg.value === 'number') {
          const noise = (Math.random() - 0.5) * reg.value * 0.02
          reg.value = Math.round((reg.value + noise) * 100) / 100
          reg.updatedAt = Date.now()
          const key = `${dev.id}_${reg.address}`
          if (!historyData.value[key]) historyData.value[key] = { time: [], values: [] }
          historyData.value[key].time.push(Date.now())
          historyData.value[key].values.push(reg.value)
          if (historyData.value[key].time.length > 100) {
            historyData.value[key].time.shift()
            historyData.value[key].values.shift()
          }
          if (reg.name === '温度' && reg.value > 28) {
            alarms.value.unshift(
              createAlarm(dev.id, reg.name, `${dev.name} ${reg.name}超限: ${reg.value}${reg.unit}`, reg.value > 30 ? 'critical' : 'warning')
            )
          }
          if (reg.name === '管道压力' && reg.value > 4.0) {
            alarms.value.unshift(
              createAlarm(dev.id, reg.name, `${dev.name} ${reg.name}超限: ${reg.value}${reg.unit}`, reg.value > 4.5 ? 'critical' : 'warning')
            )
          }
          if (reg.name === '电流' && reg.value > 15) {
            alarms.value.unshift(
              createAlarm(dev.id, reg.name, `${dev.name} ${reg.name}超限: ${reg.value}${reg.unit}`, reg.value > 18 ? 'critical' : 'warning')
            )
          }
        }
      }
    }
    if (alarms.value.length > 200) alarms.value = alarms.value.slice(0, 200)
  }

  function acknowledgeAlarm(id: string) {
    const a = alarms.value.find(a => a.id === id)
    if (a) a.acknowledged = true
  }

  function toggleDevice(id: string) {
    const d = devices.value.find(d => d.id === id)
    if (d) d.online = !d.online
  }

  return {
    devices, alarms, historyData, isPolling, pollInterval, selectedDevice,
    criticalAlarms, onlineDevices, escalatedAlarms, unacknowledgedAlarms,
    initMockDevices, simulatePoll, acknowledgeAlarm, toggleDevice,
    startEscalationChecker, stopEscalationChecker, checkEscalations, escalateAlarm,
  }
})
