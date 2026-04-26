from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import ensure_storage_dirs, settings
from core.database import SessionLocal
from core.responses import error_response
from routers import auth as auth_router
from routers import backup as backup_router
from routers import imports as imports_router
from routers import media as media_router
from routers import products as products_router
from routers import tenants as tenants_router
from routers import users as users_router
from services import auth as auth_service


def run_migrations() -> None:
    alembic_cfg = Config(str(Path(__file__).resolve().parent / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(Path(__file__).resolve().parent / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(alembic_cfg, "head")


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_storage_dirs()
    run_migrations()
    db = SessionLocal()
    try:
        auth_service.seed_startup(db)
    finally:
        db.close()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    return error_response(str(exc.detail), status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_: Request, exc: RequestValidationError):
    return error_response(str(exc), status_code=422)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"success": False, "data": None, "error": str(exc)})


@app.get("/health")
async def health():
    return {"success": True, "data": {"status": "ok"}, "error": None}


app.include_router(auth_router.router)
app.include_router(tenants_router.router)
app.include_router(users_router.router)
app.include_router(users_router.admin_router)
app.include_router(backup_router.router)
app.include_router(media_router.router)
app.include_router(imports_router.router)
app.include_router(products_router.router)
app.include_router(products_router.catalog_router)
