import pygame
import sys
import time
import random
import math
from config import WIDTH, HEIGHT, FPS, SPAWN_INTERVAL, PLAYER_RADIUS, MAP_WIDTH, MAP_HEIGHT
from difficulty import DifficultyManager

from player import Player
from enemy import Enemy
from bullet import Bullet
from enemy_bullet import EnemyBullet
from utils import draw_timer, game_over_screen, update_high_scores, display_high_scores
from explosion import Explosion
from health_pickup import HealthPickUp  # 导入HP球类
from bomb_pickup import BombPickUp
from camera import Camera
from utils import resource_path

def spawn_enemy_wave(enemies, difficulty_level):
    """Spawn a mix of enemies based on current difficulty."""
    enemies.append(Enemy(MAP_WIDTH, MAP_HEIGHT, enemy_type='basic', difficulty_level=difficulty_level))
    if random.random() < min(0.1 + 0.03 * difficulty_level, 0.4):
        enemies.append(Enemy(MAP_WIDTH, MAP_HEIGHT, enemy_type='large', difficulty_level=difficulty_level))
    if random.random() < min(0.35 + 0.04 * difficulty_level, 0.7):
        enemies.append(Enemy(MAP_WIDTH, MAP_HEIGHT, enemy_type='fast', difficulty_level=difficulty_level))
    if random.random() < min(0.25 + 0.05 * difficulty_level, 0.7):
        enemies.append(Enemy(MAP_WIDTH, MAP_HEIGHT, enemy_type='shooter', difficulty_level=difficulty_level))
    if random.random() < min(0.5 + 0.1 * difficulty_level, 0.9):
        enemies.append(Enemy(MAP_WIDTH, MAP_HEIGHT, enemy_type='basic', difficulty_level=difficulty_level))


def reset_game():
    player = Player(MAP_WIDTH // 2, MAP_HEIGHT // 2)  # 玩家初始位置
    explosions = []
    enemies = []
    bullets = []
    enemy_bullets = []
    pickups = []  # 新增的掉落物列表
    start_time = time.time()
    score = 0
    diff_manager = DifficultyManager(SPAWN_INTERVAL)
    print(f"Initial Player HP: {player.hp}")

    spawn_event = pygame.USEREVENT + 1
    pygame.time.set_timer(spawn_event, diff_manager.spawn_interval)
    return player, explosions, enemies, bullets, enemy_bullets, pickups, start_time, spawn_event, score, diff_manager

def main():
    pygame.init()

    # 初始化音频系统
    pygame.mixer.init()

    # 加载背景音乐（循环播放）
    pygame.mixer.music.load(resource_path("music/bg.mp3"))
    pygame.mixer.music.play(-1)  # -1 表示无限循环
    pygame.mixer.music.set_volume(0.5)  # 可调节音量（0.0 到 1.0）


    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("逃出真冬学姐的sekai")
    icon = pygame.image.load("img/player.png").convert_alpha()
    camera = Camera(MAP_WIDTH, MAP_HEIGHT, WIDTH, HEIGHT)

    pygame.display.set_icon(icon)

    display_high_scores(screen)

    clock = pygame.time.Clock()

    bg_image = pygame.image.load(resource_path("img/bg.png")).convert()
    bg_image = pygame.transform.scale(bg_image, (MAP_WIDTH, MAP_HEIGHT))
    bg_rect = bg_image.get_rect()

    player, explosions, enemies, bullets, enemy_bullets, pickups, start_time, spawn_event, score, diff_manager = reset_game()

    running = True
    game_over = False  # Game Over 状态变量
    while running:
        clock.tick(FPS)
        screen.blit(bg_image, camera.apply(bg_rect))

        elapsed_time = time.time() - start_time
        if diff_manager.update(elapsed_time):
            pygame.time.set_timer(spawn_event, diff_manager.spawn_interval)
            print(f"[难度升级] 当前等级：{diff_manager.current_level}")
        difficulty_level = diff_manager.current_level

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()

            if event.type == spawn_event:
                spawn_enemy_wave(enemies, difficulty_level)

            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    if player.can_shoot():
                        bullet_count = max(1, len(enemies) // 10 + 1)
                        targets = sorted(enemies, key=lambda e: (e.x - player.x) ** 2 + (e.y - player.y) ** 2)
                        for i in range(min(bullet_count, len(targets))):
                            bullets.append(Bullet(player.x, player.y, targets[i]))
                        player.reset_shoot_time()  # 重置射击时间
                elif event.key == pygame.K_b and player.bomb_count > 0:
                    explosions.append(Explosion(player.x, player.y, explosion_type="big"))
                    for enemy in enemies[:]:
                        if math.hypot(enemy.x - player.x, enemy.y - player.y) < 200:
                            explosions.append(Explosion(enemy.x, enemy.y, explosion_type="enemy"))
                            score += enemy.score
                            enemies.remove(enemy)
                    player.bomb_count -= 1

        if game_over:
            # 游戏结束时，显示计时器和游戏结束画面
            survival_time = draw_timer(screen, start_time)
            pygame.display.flip()
            game_over_screen(screen, survival_time)
            pygame.time.wait(5000)  # 等待5秒显示游戏结束画面
            running = False  # 停止游戏循环

        if not game_over:
            keys = pygame.key.get_pressed()
            player.move(keys)
            player.draw(screen, camera)
            camera.update(player)

            for bullet in bullets[:]:
                bullet.move()
                bullet.draw(screen, camera)
                if bullet.off_screen():
                    bullets.remove(bullet)

            for ebullet in enemy_bullets[:]:
                ebullet.move()
                ebullet.draw(screen, camera)
                if ebullet.off_screen():
                    enemy_bullets.remove(ebullet)

            for enemy in enemies[:]:
                enemy.move_towards(player)
                enemy.draw(screen, camera)
                if enemy.enemy_type == 'shooter' and enemy.can_shoot():
                    enemy_bullets.append(enemy.shoot(player))

                if enemy.collides_with(player):
                    if player.is_invincible():
                        continue  # 无敌状态下无视碰撞
                    print("Player collided with enemy. Game Over!")
                    print(f"Player HP: {player.hp}")
                    player.hp -= 1
                    player.activate_invincibility()  # 启动无敌状态

                    if player.hp <= 0:
                        explosions.append(Explosion(player.x, player.y, explosion_type="player"))
                        game_over = True
                        break
                    else:
                        explosions.append(Explosion(player.x, player.y))  # 普通爆炸

                    enemies.remove(enemy)
                    break

            for bullet in bullets[:]:
                for enemy in enemies[:]:
                    if bullet.hits(enemy):
                        enemy.hp -= 1
                        bullets.remove(bullet)
                        explosions.append(Explosion(enemy.x, enemy.y))
                        score += enemy.score

                        if enemy.hp <= 0:
                            if random.random() < 0.2:
                                pickups.append(HealthPickUp(enemy.x, enemy.y))
                            if random.random() < 0.1:
                                pickups.append(BombPickUp(enemy.x, enemy.y))

                        if enemy.hp <= 0:
                            enemies.remove(enemy)
                        break  # 删除敌人后跳出循环

            for ebullet in enemy_bullets[:]:
                if ebullet.hits(player):
                    enemy_bullets.remove(ebullet)
                    if player.is_invincible():
                        continue
                    player.hp -= 1
                    player.activate_invincibility()
                    explosions.append(Explosion(player.x, player.y))
                    if player.hp <= 0:
                        explosions.append(Explosion(player.x, player.y, explosion_type="player"))
                        game_over = True
                        break

            for pickup in pickups[:]:
                pickup.draw(screen, camera)
                if pickup.check_collision(player):
                    if isinstance(pickup, HealthPickUp):
                        player.hp += 1
                        if player.hp > player.max_hp:
                            player.hp = player.max_hp
                    elif isinstance(pickup, BombPickUp):
                        player.bomb_count += 1
                    pickups.remove(pickup)

            for explosion in explosions[:]:
                explosion.update()
                explosion.draw(screen, camera)
                if explosion.is_finished():
                    explosions.remove(explosion)

            # 显示冷却槽
            player.draw_hp(screen, camera)
            player.draw_cooldown_bar(screen, camera)
            player.draw_bomb_count(screen)

            elapsed_time = draw_timer(screen, start_time)
            score_text = pygame.font.SysFont(None, 30).render(f"Score: {score}", True, (255, 255, 255))
            screen.blit(score_text, (WIDTH - score_text.get_width() - 10, 10))

            difficulty_text = pygame.font.SysFont(None, 30).render(f"Diff: {difficulty_level}", True, (255, 255, 0))
            screen.blit(difficulty_text, (10, 40))
            next_cd = diff_manager.time_to_next_level(elapsed_time)
            next_diff_text = pygame.font.SysFont(None, 30).render(
                f"Next diff in: {next_cd}s", True, (255, 255, 0)
            )
            screen.blit(next_diff_text, (10, 100))

            pygame.display.flip()

    update_high_scores(score)


if __name__ == "__main__":
    main()
