from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from cryptography.fernet import Fernet
from fastapi import HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext

from core.config import settings


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
fernet = Fernet(settings.fernet_key.encode())


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return pwd_context.verify(password, hashed_password)


def create_access_token(user_id: UUID) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.access_token_expire_hours)
    payload = {"sub": str(user_id), "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        ) from exc


def encrypt_secret(value: str) -> str:
    return fernet.encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    return fernet.decrypt(value.encode()).decode()
