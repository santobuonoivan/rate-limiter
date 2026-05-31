import { Controller, Get, Post, Body, HttpCode } from "@nestjs/common";

/**
 * Controller de demostración para testear el Rate Limiter.
 *
 * Incluye varios endpoints con diferentes límites configurados
 * para demostrar cómo funciona el sistema en diferentes escenarios.
 *
 * Endpoints:
 * - GET /api/test - 10 req/min (testing general)
 * - GET /api/health - 200 req/min (health checks sin límite estricto)
 * - POST /api/auth/login - 5 req/min (prevención brute force)
 * - POST /api/posts - 10 req/min (creación de contenido)
 * - GET /api/feed - 60 req/min (lectura de contenido)
 */
@Controller("api")
export class TestController {
  /**
   * Endpoint de testing básico
   * Rate limit: 10 requests/minuto
   */
  @Get("test")
  test(): { message: string; timestamp: number } {
    return {
      message: "Rate limiter is working!",
      timestamp: Date.now(),
    };
  }

  /**
   * Health check endpoint
   * Rate limit: 200 requests/minuto (muy permisivo)
   */
  @Get("health")
  health(): { status: string; timestamp: number } {
    return {
      status: "ok",
      timestamp: Date.now(),
    };
  }

  /**
   * Simulación de login
   * Rate limit: 5 requests/minuto (previene brute force)
   */
  @Post("auth/login")
  @HttpCode(200)
  login(@Body() credentials: { username: string; password: string }): {
    message: string;
    username: string;
  } {
    // En producción: validar credenciales, generar JWT, etc.
    return {
      message: "Login successful (demo)",
      username: credentials.username,
    };
  }

  /**
   * Simulación de creación de post
   * Rate limit: 10 requests/minuto
   */
  @Post("posts")
  @HttpCode(201)
  createPost(@Body() post: { title: string; content: string }): {
    message: string;
    post: { id: string; title: string; createdAt: number };
  } {
    return {
      message: "Post created (demo)",
      post: {
        id: `post-${Date.now()}`,
        title: post.title,
        createdAt: Date.now(),
      },
    };
  }

  /**
   * Simulación de feed de contenido
   * Rate limit: 60 requests/minuto (lectura más permisiva)
   */
  @Get("feed")
  getFeed(): {
    message: string;
    items: Array<{ id: string; title: string }>;
  } {
    return {
      message: "Feed retrieved (demo)",
      items: [
        { id: "1", title: "Sample post 1" },
        { id: "2", title: "Sample post 2" },
        { id: "3", title: "Sample post 3" },
      ],
    };
  }

  /**
   * Simulación de creación de comentario
   * Rate limit: 30 requests/minuto
   */
  @Post("comments")
  @HttpCode(201)
  createComment(@Body() comment: { postId: string; content: string }): {
    message: string;
    comment: { id: string; postId: string; createdAt: number };
  } {
    return {
      message: "Comment created (demo)",
      comment: {
        id: `comment-${Date.now()}`,
        postId: comment.postId,
        createdAt: Date.now(),
      },
    };
  }

  /**
   * Simulación de registro de usuario
   * Rate limit: 3 requests/hora (muy restrictivo)
   */
  @Post("auth/register")
  @HttpCode(201)
  register(
    @Body() userData: { username: string; email: string; password: string },
  ): { message: string; username: string } {
    return {
      message: "User registered (demo)",
      username: userData.username,
    };
  }
}
