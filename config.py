import pygame

# 屏幕参数
WIDTH, HEIGHT = 1024, 768
FPS = 60

# 玩家相关配置
PLAYER_RADIUS = 40
PLAYER_SPEED = 5

# 敌人
ENEMY_RADIUS = 30
ENEMY_ACCELERATION = 0.05
ENEMY_MAX_SPEED = 2
ENEMY_HP = 5
SPAWN_INTERVAL = 3000  # ms

# 子弹
BULLET_RADIUS = 20
BULLET_SPEED = 5

# 颜色
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
RED = (220, 20, 60)
BLUE = (30, 144, 255)
YELLOW = (255, 215, 0)
ORANGE = (255, 165, 0)
# config.py
GREEN = (0, 255, 0)  # RGB values for green

# 字体
pygame.font.init()
font = pygame.font.SysFont(None, 36)
big_font = pygame.font.SysFont(None, 72)
