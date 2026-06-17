from fastapi import APIRouter, Query
from typing import Optional
from app.services.modbus_service import (
    read_registers, get_device_status,
    get_alarms, acknowledge_alarm, check_escalations, get_escalation_stats,
)
from app.models.schemas import AlarmAckRequest

router = APIRouter()

@router.get("/modbus/devices")
def list_devices():
    return get_device_status()

@router.get("/modbus/read/{device_id}/{address}/{count}")
def read_holding(device_id: str, address: int, count: int = 1):
    return read_registers(device_id, address, count)

@router.post("/modbus/write/{device_id}/{address}")
def write_register(device_id: str, address: int, value: int):
    return {"device_id": device_id, "address": address, "value": value, "status": "written"}

@router.get("/alarms")
def list_alarms(acknowledged: Optional[bool] = Query(None)):
    return get_alarms(acknowledged)

@router.post("/alarms/{alarm_id}/acknowledge")
def ack_alarm(alarm_id: str):
    alarm = acknowledge_alarm(alarm_id)
    if not alarm:
        return {"error": "Alarm not found"}
    return alarm

@router.post("/alarms/check-escalation")
def trigger_escalation_check():
    escalated = check_escalations()
    return {"escalated_count": len(escalated), "escalated_alarms": escalated}

@router.get("/alarms/escalation-stats")
def escalation_stats():
    return get_escalation_stats()
