from pydantic import BaseModel
from typing import List, Optional
from enum import Enum

class AlarmLevel(str, Enum):
    info = "info"
    warning = "warning"
    critical = "critical"

class ModbusRegister(BaseModel):
    address: int
    name: str
    type: str
    value: float
    unit: str

class Device(BaseModel):
    id: str
    name: str
    ip: str
    port: int
    slave_id: int
    online: bool
    registers: List[ModbusRegister] = []

class EscalationRecord(BaseModel):
    from_level: AlarmLevel
    to_level: AlarmLevel
    escalation_level: int
    timestamp: float
    responsible_person: str
    responsible_role: str
    reason: str

class Alarm(BaseModel):
    id: str
    device_id: str
    register: str
    message: str
    level: AlarmLevel
    timestamp: float
    acknowledged: bool = False
    escalation_level: int = 0
    escalated_at: Optional[float] = None
    responsible_person: str = "值班操作员"
    responsible_role: str = "一线运维"
    escalation_history: List[EscalationRecord] = []

class AlarmAckRequest(BaseModel):
    alarm_id: str

class EscalationConfig(BaseModel):
    level_0_timeout: int = 30
    level_1_timeout: int = 60
    level_2_timeout: int = 120
    max_escalation_level: int = 3

class EscalationStats(BaseModel):
    total_alarms: int
    unacknowledged: int
    escalated: int
    by_responsibility: dict
