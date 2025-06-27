import pygame
import math
from config import WIDTH, HEIGHT, BULLET_RADIUS, BULLET_SPEED
from utils import resource_path

class EnemyBullet:
    def __init__(self, x, y, target):
        self.x = x
        self.y = y
        self.radius = BULLET_RADIUS // 2

        original_image = pygame.image.load(resource_path("img/bullet.png")).convert_alpha()
        original_image = pygame.transform.scale(original_image, (self.radius * 2, self.radius * 2))

        dx = target.x - self.x
        dy = target.y - self.y
        dist = math.hypot(dx, dy) or 1
        self.vx = BULLET_SPEED * dx / dist
        self.vy = BULLET_SPEED * dy / dist

        angle_deg = math.degrees(math.atan2(-dy, dx)) - 90
        self.image = pygame.transform.rotate(original_image, angle_deg)
        self.rect = self.image.get_rect(center=(self.x, self.y))

    def move(self):
        self.x += self.vx
        self.y += self.vy
        self.rect.center = (self.x, self.y)

    def draw(self, screen):
        screen.blit(self.image, self.rect)

    def off_screen(self):
        margin = 20
        return self.x < -margin or self.x > WIDTH + margin or self.y < -margin or self.y > HEIGHT + margin

    def hits(self, player):
        dx = self.x - player.x
        dy = self.y - player.y
        return math.hypot(dx, dy) < (self.radius + player.radius)
