import pygame
import math
import time
from player import Player
from utils import resource_path


class HealthPickUp:
    def __init__(self, x, y):
        self.base_x = x
        self.base_y = y
        self.radius = 15

        self.image = pygame.image.load(resource_path("img/health.png")).convert_alpha()
        self.image = pygame.transform.scale(self.image, (2 * self.radius, 2 * self.radius))

        self.spawn_time = time.time()

        # 更大、更宽松的发光层，避免裁剪边缘
        self.glow_surface = pygame.Surface((120, 120), pygame.SRCALPHA)

    def draw(self, screen):
        t = time.time() - self.spawn_time

        # 悬浮动画
        float_offset = math.sin(t * 2) * 5
        draw_x = self.base_x
        draw_y = self.base_y + float_offset

        # 发光效果
        self.glow_surface.fill((0, 0, 0, 0))  # 清空

        for i in range(4):
            pulse = 1.5 + 0.2 * i
            radius = int(25 + 10 * pulse + 2 * math.sin(t * (3 + i)))
            alpha = max(20, 50 - i * 10 + int(10 * math.sin(t * (4 + i))))  # 更柔和，alpha更低

            pygame.draw.circle(
                self.glow_surface,
                (0, 255, 100, alpha),
                (60, 60),  # 中心
                radius
            )

        screen.blit(self.glow_surface, (draw_x - 60, draw_y - 60), special_flags=pygame.BLEND_RGBA_ADD)

        # 血球贴图
        rect = self.image.get_rect(center=(draw_x, draw_y))
        screen.blit(self.image, rect)

        self.rect = rect

    def check_collision(self, player: Player):
        player_rect = pygame.Rect(
            player.x - player.radius,
            player.y - player.radius,
            player.radius * 2,
            player.radius * 2
        )
        return self.rect.colliderect(player_rect)
