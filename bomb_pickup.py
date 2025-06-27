import pygame
import math
import time
from config import font, BLACK

class BombPickUp:
    def __init__(self, x, y):
        self.base_x = x
        self.base_y = y
        self.radius = 15
        self.spawn_time = time.time()

    def draw(self, screen):
        t = time.time() - self.spawn_time
        float_offset = math.sin(t * 2) * 5
        draw_x = self.base_x
        draw_y = self.base_y + float_offset

        pygame.draw.circle(screen, (255, 215, 0), (int(draw_x), int(draw_y)), self.radius)
        letter = font.render('B', True, BLACK)
        screen.blit(letter, (draw_x - letter.get_width() // 2, draw_y - letter.get_height() // 2))

        self.rect = pygame.Rect(draw_x - self.radius, draw_y - self.radius, self.radius * 2, self.radius * 2)

    def check_collision(self, player):
        player_rect = pygame.Rect(player.x - player.radius, player.y - player.radius, player.radius * 2, player.radius * 2)
        return self.rect.colliderect(player_rect)
