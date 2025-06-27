import pygame
import math
from config import WIDTH, HEIGHT, BULLET_RADIUS, BULLET_SPEED, MAP_WIDTH, MAP_HEIGHT
from utils import resource_path

class EnemyBullet:
    def __init__(self, x, y, target=None, angle=None):
        self.x = x
        self.y = y
        self.radius = BULLET_RADIUS // 2

        base_image = pygame.image.load(resource_path("img/bullet.png")).convert_alpha()
        base_image = pygame.transform.scale(base_image, (self.radius * 2, self.radius * 2))
        # Tint bullet red
        base_image.fill((255, 0, 0), special_flags=pygame.BLEND_RGBA_MULT)

        if angle is not None:
            # Angle in radians
            self.vx = BULLET_SPEED * math.cos(angle)
            self.vy = BULLET_SPEED * math.sin(angle)
            angle_deg = math.degrees(math.atan2(-self.vy, self.vx)) - 90
        else:
            dx = target.x - self.x
            dy = target.y - self.y
            dist = math.hypot(dx, dy) or 1
            self.vx = BULLET_SPEED * dx / dist
            self.vy = BULLET_SPEED * dy / dist
            angle_deg = math.degrees(math.atan2(-dy, dx)) - 90

        self.image = pygame.transform.rotate(base_image, angle_deg)
        self.rect = self.image.get_rect(center=(self.x, self.y))
        # Pre-create glow surface
        self.glow_surf = pygame.Surface((self.radius * 4, self.radius * 4), pygame.SRCALPHA)
        pygame.draw.circle(self.glow_surf, (255, 0, 0, 120), (self.radius * 2, self.radius * 2), self.radius * 2)

    def move(self):
        self.x += self.vx
        self.y += self.vy
        self.rect.center = (self.x, self.y)

    def draw(self, screen, camera):
        pos = camera.apply(self.rect)
        glow_rect = self.glow_surf.get_rect(center=pos.center)
        screen.blit(self.glow_surf, glow_rect)
        screen.blit(self.image, pos)

    def off_screen(self):
        margin = 20
        return self.x < -margin or self.x > MAP_WIDTH + margin or self.y < -margin or self.y > MAP_HEIGHT + margin

    def hits(self, player):
        dx = self.x - player.x
        dy = self.y - player.y
        return math.hypot(dx, dy) < (self.radius + player.radius)
