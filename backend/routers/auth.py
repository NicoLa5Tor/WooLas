from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.config import settings
from core.dependencies import get_current_user, get_db
from core.responses import success_response
from schemas.auth import LoginRequest
from services import auth as auth_service


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
async def login(payload: LoginRequest, db: Session = Depends(get_db)):
    me, token = auth_service.login_user(db, payload.username, payload.password)
    response = success_response(me.model_dump(mode="json"))
    response.set_cookie(
        key=settings.access_cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=settings.access_token_expire_hours * 60 * 60,
    )
    return response


@router.post("/logout")
async def logout():
    auth_service.logout_user()
    response = success_response({"message": "Logged out"})
    response.delete_cookie(settings.access_cookie_name, httponly=True, samesite="lax")
    return response


@router.get("/me")
async def me(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return success_response(auth_service.build_me_response(db, current_user).model_dump(mode="json"))
