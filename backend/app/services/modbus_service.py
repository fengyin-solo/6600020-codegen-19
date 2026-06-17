"""Modbus service with mock data (replace with pymodbus for production)."""
import random
import time
from typing import List, Dict, Any, Optional
from app.models.schemas import Alarm, AlarmLevel, EscalationRecord, EscalationStats

MOCK_DEVICES = [
    {"id": "dev1", "name": "温湿度传感器-A区", "ip": "192.168.1.101", "port": 502, "slave_id": 1, "online": True},
    {"id": "dev2", "name": "压力变送器-B区", "ip": "192.168.1.102", "port": 502, "slave_id": 2, "online": True},
    {"id": "dev3", "name": "电机控制器-C区", "ip": "192.168.1.103", "port": 502, "slave_id": 3, "online": False},
]

LEVEL_ORDER = [AlarmLevel.info, AlarmLevel.warning, AlarmLevel.critical]

ESCALATION_TIMEOUTS = {0: 30, 1: 60, 2: 120}

RESPONSIBILITY_CHAIN: Dict[int, Dict[str, str]] = {
    0: {"person": "值班操作员", "role": "一线运维"},
    1: {"person": "运维主管", "role": "二线主管"},
    2: {"person": "生产厂长", "role": "三线决策"},
    3: {"person": "公司高管", "role": "最高决策"},
}

_alarms_store: Dict[str, Alarm] = {}


def get_device_status() -> List[Dict[str, Any]]:
    return MOCK_DEVICES


def read_registers(device_id: str, address: int, count: int) -> Dict[str, Any]:
    values = [round(random.uniform(0, 100), 2) for _ in range(count)]
    return {"device_id": device_id, "address": address, "values": values}


def create_alarm(device_id: str, register: str, message: str, level: AlarmLevel) -> Alarm:
    chain = RESPONSIBILITY_CHAIN[0]
    alarm = Alarm(
        id=f"a_{int(time.time()*1000)}_{random.randint(1000,9999)}",
        device_id=device_id,
        register=register,
        message=message,
        level=level,
        timestamp=time.time() * 1000,
        acknowledged=False,
        escalation_level=0,
        escalated_at=None,
        responsible_person=chain["person"],
        responsible_role=chain["role"],
        escalation_history=[],
    )
    _alarms_store[alarm.id] = alarm
    return alarm


def get_alarms(acknowledged: Optional[bool] = None) -> List[Alarm]:
    alarms = list(_alarms_store.values())
    if acknowledged is not None:
        alarms = [a for a in alarms if a.acknowledged == acknowledged]
    return sorted(alarms, key=lambda a: a.timestamp, reverse=True)


def acknowledge_alarm(alarm_id: str) -> Optional[Alarm]:
    alarm = _alarms_store.get(alarm_id)
    if alarm:
        alarm.acknowledged = True
    return alarm


def _next_level(current: AlarmLevel) -> Optional[AlarmLevel]:
    idx = LEVEL_ORDER.index(current)
    return LEVEL_ORDER[idx + 1] if idx < len(LEVEL_ORDER) - 1 else None


def escalate_alarm(alarm: Alarm) -> bool:
    if alarm.acknowledged:
        return False
    next_lvl = _next_level(alarm.level)
    if next_lvl is None and alarm.escalation_level >= 3:
        return False
    from_level = alarm.level
    new_esc_level = alarm.escalation_level + 1
    chain = RESPONSIBILITY_CHAIN.get(min(new_esc_level, 3), RESPONSIBILITY_CHAIN[3])
    timeout = ESCALATION_TIMEOUTS.get(alarm.escalation_level, 60)
    record = EscalationRecord(
        from_level=from_level,
        to_level=next_lvl or alarm.level,
        escalation_level=new_esc_level,
        timestamp=time.time() * 1000,
        responsible_person=chain["person"],
        responsible_role=chain["role"],
        reason=f"告警超时 {timeout}s 未确认，自动升级至第{new_esc_level}级",
    )
    alarm.escalation_level = new_esc_level
    alarm.escalated_at = time.time() * 1000
    alarm.responsible_person = chain["person"]
    alarm.responsible_role = chain["role"]
    alarm.escalation_history.append(record)
    if next_lvl:
        alarm.level = next_lvl
    return True


def check_escalations() -> List[Alarm]:
    now = time.time() * 1000
    escalated = []
    for alarm in _alarms_store.values():
        if alarm.acknowledged or alarm.escalation_level >= 3:
            continue
        timeout = ESCALATION_TIMEOUTS.get(alarm.escalation_level, 60) * 1000
        base_ts = alarm.escalated_at or alarm.timestamp
        if now - base_ts >= timeout:
            if escalate_alarm(alarm):
                escalated.append(alarm)
    return escalated


def get_escalation_stats() -> EscalationStats:
    alarms = list(_alarms_store.values())
    by_resp: Dict[str, int] = {}
    for a in alarms:
        if a.acknowledged:
            continue
        by_resp[a.responsible_role] = by_resp.get(a.responsible_role, 0) + 1
    return EscalationStats(
        total_alarms=len(alarms),
        unacknowledged=len([a for a in alarms if not a.acknowledged]),
        escalated=len([a for a in alarms if a.escalation_level > 0 and not a.acknowledged]),
        by_responsibility=by_resp,
    )
